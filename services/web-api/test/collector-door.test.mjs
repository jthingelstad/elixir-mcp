import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { makeCollectorDoor } from "../src/collector-door.mjs";
import { enqueueJob, ledgerStats } from "../../scheduler/src/ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_door_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const TOKEN_BULK = "emcg_bulk_operator_token";
const TOKEN_LIVE = "emcg_live_owner_token";
const TOKEN_REVOKED = "emcg_revoked_token";

let db;
let door;
const notices = [];
const ingested = [];

const authed = (token) => ({ headers: { authorization: `Bearer ${token}` } });
const JOB = { endpoint: "player", entity_key: "#20JJJ2CCRU", lane: "bulk" };

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('door-owner', 'approved', true)
     returning account_id`,
  );
  for (const [name, token, channel, status] of [
    ["bulk-op", TOKEN_BULK, "bulk", "active"],
    ["live-own", TOKEN_LIVE, "live", "active"],
    ["revoked-op", TOKEN_REVOKED, "bulk", "revoked"],
  ]) {
    await db.query(
      `insert into gateway (owner_account_id, name, token_hash, channel, status)
       values ($1, $2, $3, $4, $5)`,
      [acct.account_id, name, sha256(token), channel, status],
    );
  }
  await db.query(
    `insert into collector_release (platform, version, sha256, url)
     values ('go-darwin-arm64', '2.0.0', $1, 'https://example.com/collector')`,
    [sha256("binary")],
  );
  door = makeCollectorDoor({
    ingest: async (dbc, envelope) => {
      ingested.push(envelope);
      return { outcome: "admitted" };
    },
    notifyOwner: async (n) => notices.push(n),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("auth: bad, missing, and revoked tokens never pass", async () => {
  for (const ev of [
    { headers: {} },
    authed("emcg_wrong"),
    authed(TOKEN_REVOKED),
    { headers: { authorization: "Bearer svc_not_a_gateway" } },
  ]) {
    const r = await door.config(db, ev);
    assert.equal(r.status, 401);
  }
});

test("config: contract constants, channel, and the update authority", async () => {
  const r = await door.config(db, authed(TOKEN_BULK));
  assert.equal(r.status, 200);
  assert.equal(r.body.pacing_ms, 1500);
  assert.equal(r.body.gateway.channel, "bulk");
  assert.equal(r.body.update["go-darwin-arm64"].version, "2.0.0");
});

test("ledger: enqueue dedups per subject and live upgrades bulk", async () => {
  await enqueueJob(db, JOB);
  await enqueueJob(db, JOB); // idempotent by construction
  const { rows: one } = await db.query(
    `select count(*)::int n from job where status = 'queued' and entity_key = $1`,
    [JOB.entity_key],
  );
  assert.equal(one[0].n, 1);
  await enqueueJob(db, { ...JOB, lane: "live" });
  const { rows: up } = await db.query(
    `select lane from job where status = 'queued' and entity_key = $1`,
    [JOB.entity_key],
  );
  assert.equal(up[0].lane, "live", "live upgrades the queued row");
  await db.query(`delete from job`);
});

test("lease: bulk collectors never receive live jobs; server computes cr_path", async () => {
  await enqueueJob(db, { ...JOB, lane: "live" });
  const empty = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  assert.equal(empty.body.empty, true, "the only job is live; bulk sees none");

  await enqueueJob(db, { ...JOB, entity_key: "#2YG98VVQ", lane: "bulk" });
  const r = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.job.entity_key, "#2YG98VVQ");
  assert.equal(r.body.cr_path, "/players/%232YG98VVQ");
  assert.match(r.body.lease, /^\d+$/, "the lease is a ledger row id");

  // Live channel drains live first.
  const live = await door.lease(db, authed(TOKEN_LIVE), { wait_s: 0 });
  assert.equal(live.body.job.lane, "live");

  // Submit both to clean up.
  for (const [tok, lease] of [
    [TOKEN_BULK, r.body.lease],
    [TOKEN_LIVE, live.body.lease],
  ]) {
    const done = await door.submit(db, authed(tok), {
      lease,
      status: "ok",
      body_gzip_b64: Buffer.from("x").toString("base64"),
      fetched_at: new Date().toISOString(),
    });
    assert.equal(done.status, 200);
  }
});

test("submit: inline ingest, server-stamped identity, DB-bound lease", async () => {
  await enqueueJob(db, { ...JOB, entity_key: "#8U2P0JPR" });
  const r = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  const before = ingested.length;

  // Another collector cannot submit this lease: it is a DB fact.
  const stolen = await door.submit(db, authed(TOKEN_LIVE), {
    lease: r.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("z").toString("base64"),
  });
  assert.equal(stolen.status, 400);
  const junk = await door.submit(db, authed(TOKEN_BULK), {
    lease: "999999",
    status: "ok",
    body_gzip_b64: Buffer.from("z").toString("base64"),
  });
  assert.equal(junk.status, 400);

  const good = await door.submit(db, authed(TOKEN_BULK), {
    lease: r.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("z").toString("base64"),
    fetched_at: new Date().toISOString(),
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.outcome, "admitted", "pipeline outcome surfaces");
  assert.equal(ingested.length, before + 1);
  const envelope = ingested.at(-1);
  const { rows } = await db.query(
    `select gateway_id from gateway where name = 'bulk-op'`,
  );
  assert.equal(envelope.gateway_id, rows[0].gateway_id, "identity from token");
  assert.equal(
    envelope.job.entity_key,
    "#8U2P0JPR",
    "job identity from the row",
  );
  const { rows: closed } = await db.query(
    `select status from job where job_id = $1`,
    [Number(r.body.lease)],
  );
  assert.equal(closed[0].status, "done");
});

test("ingest exception leaves the lease held for expiry-requeue", async () => {
  const boom = makeCollectorDoor({
    ingest: async () => {
      throw new Error("db hiccup");
    },
    notifyOwner: async () => {},
  });
  await enqueueJob(db, { ...JOB, entity_key: "#PLCCYUQL" });
  const r = await boom.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  const failed = await boom.submit(db, authed(TOKEN_BULK), {
    lease: r.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("z").toString("base64"),
  });
  assert.equal(failed.status, 500);
  const { rows } = await db.query(`select status from job where job_id = $1`, [
    Number(r.body.lease),
  ]);
  assert.equal(rows[0].status, "leased", "held for expiry, not lost");
  await db.query(
    `update job set status = 'done', done_at = now() where job_id = $1`,
    [Number(r.body.lease)],
  );
});

test("lease cap and quarantine ride the ledger", async () => {
  for (const t of ["#U08P889Y0", "#2LRYLQPL", "#JRVV9VC0C"]) {
    await enqueueJob(db, { ...JOB, entity_key: t });
  }
  const a = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  const b = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const capped = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  assert.equal(capped.status, 429, "third outstanding lease refused");

  // Age the leases and prime the streak; the next lease call charges
  // the expiries and crosses the threshold.
  await db.query(
    `update job set leased_at = now() - interval '10 minutes' where status = 'leased'`,
  );
  await db.query(`update gateway set missed_streak = 8 where name = 'bulk-op'`);
  const quarantined = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  assert.equal(quarantined.status, 409);
  const { rows } = await db.query(
    `select status from gateway where name = 'bulk-op'`,
  );
  assert.equal(rows[0].status, "draining");
  assert.equal(notices.at(-1).kind, "gateway_quarantined");

  const stats = await ledgerStats(db);
  assert.ok(stats.queued_bulk >= 1, "expired leases requeued, not lost");
});
