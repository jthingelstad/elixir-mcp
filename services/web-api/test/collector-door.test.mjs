import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  makeCollectorDoor,
  encodeLease,
  decodeLease,
} from "../src/collector-door.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_door_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const SECRET = "door-secret";

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const TOKEN_BULK = "emcg_bulk_operator_token";
const TOKEN_LIVE = "emcg_live_owner_token";
const TOKEN_REVOKED = "emcg_revoked_token";

let db;
let door;
const notices = [];

/** Scripted fake SQS: queues are arrays; receive shifts, delete records. */
function fakeSqs() {
  const q = { live: [], bulk: [], results: [] };
  const deleted = [];
  const receives = [];
  let rh = 0;
  return {
    q,
    deleted,
    receives,
    async receive(key, wait) {
      receives.push({ key, wait });
      const body = q[key].shift();
      return body ? { body, receiptHandle: `rh-${key}-${(rh += 1)}` } : null;
    },
    async send(key, body) {
      q[key].push(body);
    },
    async delete(key, receiptHandle) {
      deleted.push(`${key}:${receiptHandle}`);
    },
  };
}
let sqs;

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
     values ('go', '2.0.0', $1, 'https://example.com/collector')`,
    [sha256("binary")],
  );
  sqs = fakeSqs();
  door = makeCollectorDoor({
    secret: SECRET,
    sqs,
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

test("auth: bad, missing, and revoked tokens never pass; static_ip is optional now", async () => {
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
  assert.equal(r.body.update.go.version, "2.0.0");
  assert.match(r.body.update.go.sha256, /^[0-9a-f]{64}$/);
  const { rows } = await db.query(
    `select last_heartbeat_at from gateway where name = 'bulk-op'`,
  );
  assert.ok(rows[0].last_heartbeat_at, "any authed call heartbeats");
});

test("lease: bulk collectors never touch the live queue; server computes cr_path", async () => {
  sqs.q.live.push(JSON.stringify({ ...JOB, lane: "live" }));
  sqs.q.bulk.push(JSON.stringify(JOB));
  sqs.receives.length = 0;
  const r = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.job, JOB);
  assert.equal(r.body.cr_path, "/players/%2320JJJ2CCRU");
  assert.ok(
    sqs.receives.every((x) => x.key === "bulk"),
    "bulk channel never peeks live",
  );
  assert.ok(r.body.lease.includes("."), "lease is signed");
  // Clean up: submit it so later tests start with no outstanding leases.
  const ok = await door.submit(db, authed(TOKEN_BULK), {
    lease: r.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("x").toString("base64"),
    fetched_at: new Date().toISOString(),
  });
  assert.equal(ok.status, 200);
});

test("lease: live channel drains live first", async () => {
  sqs.q.live.length = 0;
  sqs.q.bulk.length = 0;
  sqs.q.live.push(JSON.stringify({ ...JOB, lane: "live" }));
  sqs.q.bulk.push(JSON.stringify(JOB));
  const r = await door.lease(db, authed(TOKEN_LIVE), {});
  assert.equal(r.status, 200);
  assert.equal(r.body.job.lane, "live");
  const done = await door.submit(db, authed(TOKEN_LIVE), {
    lease: r.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("y").toString("base64"),
  });
  assert.equal(done.status, 200);
  sqs.q.bulk.length = 0;
});

test("submit: envelope identity is SERVER-stamped and lease tampering fails", async () => {
  sqs.q.bulk.push(JSON.stringify(JOB));
  const r = await door.lease(db, authed(TOKEN_BULK), {});
  const results_before = sqs.q.results.length;

  // Tamper: another collector's token cannot submit this lease.
  const stolen = await door.submit(db, authed(TOKEN_LIVE), {
    lease: r.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("z").toString("base64"),
  });
  assert.equal(stolen.status, 400, "lease is bound to its gateway");

  // Tamper: altering the payload breaks the signature.
  const decoded = decodeLease(SECRET, r.body.lease);
  const forged = `${Buffer.from(
    JSON.stringify({ ...decoded, job: { ...JOB, entity_key: "#2YG98VVQ" } }),
  ).toString("base64url")}.${r.body.lease.split(".")[1]}`;
  const bad = await door.submit(db, authed(TOKEN_BULK), {
    lease: forged,
    status: "ok",
    body_gzip_b64: Buffer.from("z").toString("base64"),
  });
  assert.equal(bad.status, 400, "signature covers the job");

  const good = await door.submit(db, authed(TOKEN_BULK), {
    lease: r.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("z").toString("base64"),
    fetched_at: new Date().toISOString(),
  });
  assert.equal(good.status, 200);
  assert.equal(sqs.q.results.length, results_before + 1);
  const envelope = JSON.parse(sqs.q.results.at(-1));
  const { rows } = await db.query(
    `select gateway_id from gateway where name = 'bulk-op'`,
  );
  assert.equal(
    envelope.gateway_id,
    rows[0].gateway_id,
    "identity comes from the token, never the client",
  );
  assert.deepEqual(envelope.job, JOB);
  assert.ok(sqs.deleted.at(-1).startsWith("bulk:"), "request message deleted");
});

test("lease cap: at most 2 outstanding; quarantine flips after the streak", async () => {
  sqs.q.bulk.push(
    JSON.stringify(JOB),
    JSON.stringify(JOB),
    JSON.stringify(JOB),
  );
  const a = await door.lease(db, authed(TOKEN_BULK), {});
  const b = await door.lease(db, authed(TOKEN_BULK), {});
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const capped = await door.lease(db, authed(TOKEN_BULK), {});
  assert.equal(capped.status, 429, "third outstanding lease refused");

  // Expire both by aging their rows; the streak charges them.
  await db.query(
    `update gateway_lease set issued_at = now() - interval '10 minutes'`,
  );
  await db.query(`update gateway set missed_streak = 9 where name = 'bulk-op'`);
  sqs.q.bulk.push(JSON.stringify(JOB));
  const quarantined = await door.lease(db, authed(TOKEN_BULK), {});
  assert.equal(quarantined.status, 409, "streak crossed -> quarantined");
  const { rows } = await db.query(
    `select status from gateway where name = 'bulk-op'`,
  );
  assert.equal(rows[0].status, "draining");
  assert.equal(notices.at(-1).kind, "gateway_quarantined");

  // Draining still submits (finish outstanding work) but cannot lease.
  const noLease = await door.lease(db, authed(TOKEN_BULK), {});
  assert.equal(noLease.status, 401, "draining cannot lease");
  const cfg = await door.config(db, authed(TOKEN_BULK));
  assert.equal(cfg.status, 200, "draining still reads config/submits");
});

test("lease codec round-trips and rejects garbage", () => {
  const t = encodeLease(SECRET, { g: "x", l: 1, q: "bulk", rh: "r", job: JOB });
  assert.deepEqual(decodeLease(SECRET, t).job, JOB);
  assert.equal(decodeLease(SECRET, "junk"), null);
  assert.equal(decodeLease("other-secret", t), null);
});
