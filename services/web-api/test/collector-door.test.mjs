import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  makeCollectorDoor,
  parseClientVersion,
  clientMeetsMinimum,
  phasedCheckIn,
} from "../src/collector-door.mjs";
import {
  enqueueJob,
  ledgerStats,
  settleLeases,
} from "../../scheduler/src/ledger.mjs";

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
const TOKEN_ABANDON_OTHER = "emcg_abandon_other_settles_token";
const TOKEN_ABANDON_OWNER = "emcg_abandon_owner_settles_token";

let db;
let door;
// The door's idle-cycle clock, frozen so phase assertions are exact.
let clockMs = Date.now();
const notices = [];
const ingested = [];

const authed = (token) => ({ headers: { authorization: `Bearer ${token}` } });
const JOB = { endpoint: "player", entity_key: "#20JJJ2CCRU", lane: "bulk" };

async function gatewayRow(name) {
  const { rows } = await db.query(
    `select gateway_id, status, missed_streak, last_success_at, results_submitted
     from gateway where name = $1`,
    [name],
  );
  return rows[0];
}

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
    ["abandon-other", TOKEN_ABANDON_OTHER, "bulk", "active"],
    ["abandon-owner", TOKEN_ABANDON_OWNER, "bulk", "active"],
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
    now: () => clockMs,
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
    { headers: { authorization: "Bearer svc_not_a_gateway" } },
  ]) {
    const r = await door.config(db, ev);
    assert.equal(r.status, 401);
    const l = await door.lease(db, ev, {});
    assert.equal(l.status, 401);
  }
  // A revoked token is refused everywhere, and told so on config only,
  // where `collector doctor` reads it: "revoked" is not "typo".
  const r = await door.config(db, authed(TOKEN_REVOKED));
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "revoked");
  assert.equal((await door.lease(db, authed(TOKEN_REVOKED), {})).status, 401);
});

test("config: contract constants, channel, the update authority, and what doctor needs", async () => {
  const r = await door.config(db, {
    ...authed(TOKEN_BULK),
    requestContext: { http: { sourceIp: "203.0.113.7" } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.pacing_ms, 1500);
  assert.deepEqual(r.body.submit_retry, {
    max_attempts: 3,
    timeout_s: 20,
    backoff_ms: 500,
  });
  assert.equal(r.body.gateway.channel, "bulk");
  assert.equal(r.body.update["go-darwin-arm64"].version, "2.0.0");
  assert.equal(
    r.body.observed_ip,
    "203.0.113.7",
    "the egress IP as the door saw it",
  );
  assert.equal(r.body.doctor.cr_path, "/locations?limit=1");
  assert.equal(r.body.gateway.name, "bulk-op");
  assert.ok(
    "card" in r.body.gateway,
    "the public identity rides beside the private machine name",
  );
});

test("a pending token reads config (so doctor can say 'not yet promoted') but leases nothing", async () => {
  const TOKEN_PENDING = "emcg_pending_token";
  await db.query(
    `insert into gateway (owner_account_id, name, token_hash, channel, status)
     select owner_account_id, 'pending-op', $1, 'bulk', 'pending' from gateway limit 1`,
    [sha256(TOKEN_PENDING)],
  );
  const cfg = await door.config(db, authed(TOKEN_PENDING));
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.gateway.status, "pending");
  assert.equal((await door.lease(db, authed(TOKEN_PENDING), {})).status, 401);
  assert.equal((await door.submit(db, authed(TOKEN_PENDING), {})).status, 401);
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

test("phasedCheckIn: each collector owns an evenly spaced slot on the wall clock", () => {
  const idleS = 15;
  const fleet = 5;
  const nowMs = 1_000 * (15 * 4_000 + 4); // four seconds into a cycle
  const waits = Array.from({ length: fleet }, (_, rank) =>
    phasedCheckIn({ rank, fleet, idleS, nowMs }),
  );
  const phases = waits.map((w) => (4 + w) % idleS);
  assert.deepEqual(phases, [0, 3, 6, 9, 12], "one slot every idle_s / N");
  for (const w of waits) assert.ok(w >= 1 && w <= idleS, `1..idle_s: ${w}`);
  // Sitting on its own slot, a collector is told a full cycle, never 0.
  assert.equal(phasedCheckIn({ rank: 0, fleet, idleS, nowMs: 0 }), idleS);
  // A fleet of one still idles a whole cycle.
  assert.equal(phasedCheckIn({ rank: 0, fleet: 1, idleS, nowMs }), 11);
  // The phase is the fleet's, not the caller's: asked again at any
  // other instant the same collector lands on the same second.
  for (const tick of [0, 1, 7, 14, 29, 61]) {
    const w = phasedCheckIn({ rank: 2, fleet, idleS, nowMs: 1_000 * tick });
    assert.equal((tick + w) % idleS, 6);
  }
});

test("lease: every collector serves the live lane first; the server computes cr_path and says when to come back", async () => {
  // Check-ins, not polling (2026-09-11): an empty answer says come back
  // at the caller's own slot in the idle cycle (1..idle_s, phased per
  // collector so a fleet never arrives together); a granted job says
  // come straight back; there is no live channel.
  // Both collectors have to be in the fleet (heard from inside the
  // window) before their slots are comparable; a first contact grows
  // the fleet and re-spaces everyone on their next check-in.
  await door.lease(db, authed(TOKEN_LIVE), {});
  const idle = await door.lease(db, authed(TOKEN_BULK), {});
  assert.equal(idle.body.empty, true);
  assert.ok(
    idle.body.next_check_in_s >= 1 && idle.body.next_check_in_s <= 15,
    `idle: within the check-in cycle, got ${idle.body.next_check_in_s}`,
  );
  const nowS = Math.floor(clockMs / 1000);
  const phase = (nowS + idle.body.next_check_in_s) % 15;
  const other = await door.lease(db, authed(TOKEN_LIVE), {});
  assert.notEqual(
    (nowS + other.body.next_check_in_s) % 15,
    phase,
    "two collectors asked at the same instant get different slots",
  );
  clockMs += 7_000;
  const again = await door.lease(db, authed(TOKEN_BULK), {});
  assert.equal(
    (Math.floor(clockMs / 1000) + again.body.next_check_in_s) % 15,
    phase,
    "seven seconds later the same collector is steered to the same slot",
  );

  await enqueueJob(db, { ...JOB, entity_key: "#2YG98VVQ", lane: "bulk" });
  await enqueueJob(db, { ...JOB, lane: "live" });
  const r = await door.lease(db, authed(TOKEN_BULK), {});
  assert.equal(r.status, 200);
  assert.equal(
    r.body.job.lane,
    "live",
    "a bulk operator takes the live job first",
  );
  assert.equal(r.body.next_check_in_s, 0, "work remains: come straight back");
  assert.equal(r.body.cr_path, "/players/%2320JJJ2CCRU");
  assert.match(r.body.lease, /^\d+$/, "the lease is a ledger row id");

  const live = await door.lease(db, authed(TOKEN_LIVE), { wait_s: 8 });
  assert.equal(live.body.job.entity_key, "#2YG98VVQ");
  assert.equal(live.body.next_check_in_s, 0);

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

test("a bulk battlelog lease carries the observer's mark as a filter; live leases and unmarked observers do not; the counts ride the envelope", async () => {
  await db.query(`delete from job`);
  await db.query(
    `insert into player (player_tag) values ('#2PPLQQ'), ('#8LR0P09LR') on conflict do nothing`,
  );
  await db.query(
    `insert into battlelog_high_water (observer_tag, battle_time)
     values ('#2PPLQQ', '2026-09-11T12:34:56Z') on conflict do nothing`,
  );
  // Marked observer, bulk lane: the filter, in the API's own spelling.
  await enqueueJob(db, {
    endpoint: "player_battlelog",
    entity_key: "#2PPLQQ",
    lane: "bulk",
  });
  const marked = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  assert.equal(marked.status, 200);
  assert.deepEqual(marked.body.filter, {
    battles_after: "20260911T123456.000Z",
  });

  // The collector's counts are stamped into the envelope, validated.
  const before = ingested.length;
  const done = await door.submit(db, authed(TOKEN_BULK), {
    lease: marked.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("[]").toString("base64"),
    fetched_at: new Date().toISOString(),
    observed: 25,
    filtered: 25,
  });
  assert.equal(done.status, 200);
  assert.equal(ingested.length, before + 1);
  assert.equal(ingested.at(-1).observed, 25);
  assert.equal(ingested.at(-1).filtered, 25);

  // Unmarked observer: no filter key at all.
  await enqueueJob(db, {
    endpoint: "player_battlelog",
    entity_key: "#8LR0P09LR",
    lane: "bulk",
  });
  const unmarked = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  assert.equal(unmarked.body.job.entity_key, "#8LR0P09LR");
  assert.equal(unmarked.body.filter, undefined);
  await door.submit(db, authed(TOKEN_BULK), {
    lease: unmarked.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("[]").toString("base64"),
    fetched_at: new Date().toISOString(),
  });

  // Marked observer, LIVE lane: the agent waiting gets the whole log.
  await enqueueJob(db, {
    endpoint: "player_battlelog",
    entity_key: "#2PPLQQ",
    lane: "live",
  });
  const live = await door.lease(db, authed(TOKEN_LIVE), { wait_s: 0 });
  assert.equal(live.body.job.lane, "live");
  assert.equal(live.body.filter, undefined, "never on the live lane");
  await door.submit(db, authed(TOKEN_LIVE), {
    lease: live.body.lease,
    status: "ok",
    body_gzip_b64: Buffer.from("[]").toString("base64"),
    fetched_at: new Date().toISOString(),
  });
});

test("submit: inline ingest, server-stamped identity and job id, DB-bound lease", async () => {
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
    api_bytes: 4321,
    status: "ok",
    body_gzip_b64: Buffer.from("z").toString("base64"),
    fetched_at: new Date().toISOString(),
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.outcome, "admitted", "pipeline outcome surfaces");
  assert.equal(ingested.length, before + 1);
  const envelope = ingested.at(-1);
  const bulk = await gatewayRow("bulk-op");
  assert.equal(envelope.gateway_id, bulk.gateway_id, "identity from token");
  assert.equal(
    envelope.api_bytes,
    4321,
    "what the collector read, on the envelope",
  );
  assert.equal(
    envelope.job.entity_key,
    "#8U2P0JPR",
    "job identity from the row",
  );
  assert.equal(
    envelope.job_id,
    Number(r.body.lease),
    "job id stamped server-side from the lease row (issue #3)",
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

test("concurrent lease calls from one token never exceed the cap (issue #5)", async () => {
  await db.query(`delete from job`);
  for (const t of ["#U08P889Y0", "#2LRYLQPL", "#JRVV9VC0C", "#Y9CQ8VRV"]) {
    await enqueueJob(db, { ...JOB, entity_key: t });
  }
  // Three simultaneous calls on three separate connections — the race
  // the sequential cap test never exercised.
  const conns = await Promise.all(
    [1, 2, 3].map(async () => {
      const c = new pg.Client({ connectionString: DB_URL });
      await c.connect();
      return c;
    }),
  );
  try {
    const results = await Promise.all(
      conns.map((c) => door.lease(c, authed(TOKEN_BULK), { wait_s: 0 })),
    );
    const granted = results.filter((r) => r.status === 200 && r.body.job);
    const capped = results.filter((r) => r.status === 429);
    assert.equal(granted.length, 2, "exactly the cap is granted");
    assert.equal(capped.length, 1, "the third is refused, never a third lease");
    const { rows: outstanding } = await db.query(
      `select count(*)::int n from job j join gateway g on g.gateway_id = j.leased_by
       where g.name = 'bulk-op' and j.status = 'leased'`,
    );
    assert.equal(outstanding[0].n, 2);

    // A different gateway is independent of bulk-op's lock and cap.
    const other = await door.lease(conns[0], authed(TOKEN_LIVE), { wait_s: 0 });
    assert.equal(other.status, 200);
    assert.ok(other.body.job, "another gateway still leases concurrently");

    // Submitting releases capacity: the next lease succeeds.
    const done = await door.submit(db, authed(TOKEN_BULK), {
      lease: granted[0].body.lease,
      status: "ok",
      body_gzip_b64: Buffer.from("z").toString("base64"),
      fetched_at: new Date().toISOString(),
    });
    assert.equal(done.status, 200);
    const again = await door.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
    assert.equal(again.status, 200);
    assert.ok(again.body.job, "capacity released by the submit");
    for (const r of [granted[1], again, other]) {
      const tok = r === other ? TOKEN_LIVE : TOKEN_BULK;
      await door.submit(db, authed(tok), {
        lease: r.body.lease,
        status: "ok",
        body_gzip_b64: Buffer.from("z").toString("base64"),
        fetched_at: new Date().toISOString(),
      });
    }
  } finally {
    await Promise.all(conns.map((c) => c.end()));
  }
});

test("a rejected admission never advances last_success_at; contact is still recorded (issue #7)", async () => {
  const rejecting = makeCollectorDoor({
    ingest: async () => ({ outcome: "rejected", errors: ["body:unparseable"] }),
    notifyOwner: async () => {},
  });
  await db.query(`delete from job`);
  await enqueueJob(db, { ...JOB, entity_key: "#REJECT1" });
  const before = await gatewayRow("bulk-op");
  assert.equal(
    before.last_success_at,
    null,
    "mocked ingest never stamped success",
  );
  const r = await rejecting.lease(db, authed(TOKEN_BULK), { wait_s: 0 });
  const res = await rejecting.submit(db, authed(TOKEN_BULK), {
    lease: r.body.lease,
    status: "ok", // the client SAYS ok...
    body_gzip_b64: Buffer.from("z").toString("base64"),
    fetched_at: new Date().toISOString(),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, "rejected");
  assert.deepEqual(res.body.admission_errors, ["body:unparseable"]);
  const after = await gatewayRow("bulk-op");
  assert.equal(after.last_success_at, null, "...but admission decides success");
  assert.equal(
    Number(after.results_submitted),
    Number(before.results_submitted) + 1,
    "contact is still counted",
  );
  assert.equal(after.missed_streak, 0, "a submit resets the streak");
});

test("abandoned leases reach quarantine when ANOTHER actor settles first (issue #6)", async () => {
  await db.query(`delete from job`);
  await db.query(
    `update gateway set missed_streak = 8 where name = 'abandon-other'`,
  );
  for (const t of ["#ABN1", "#ABN2"]) {
    await enqueueJob(db, { ...JOB, entity_key: t });
    const r = await door.lease(db, authed(TOKEN_ABANDON_OTHER), { wait_s: 0 });
    assert.equal(r.status, 200);
  }
  await db.query(
    `update job set leased_at = now() - interval '10 minutes' where status = 'leased'`,
  );
  // The scheduler (or any other collector) settles before the owner polls.
  const settled = await settleLeases(db);
  assert.equal(settled.missed, 2, "the expiries are attributed at settlement");
  assert.equal((await gatewayRow("abandon-other")).missed_streak, 10);

  // Pre-fix: ownership was already cleared, so this poll saw streak 8.
  const quarantined = await door.lease(db, authed(TOKEN_ABANDON_OTHER), {
    wait_s: 0,
  });
  assert.equal(quarantined.status, 409);
  const gw = await gatewayRow("abandon-other");
  assert.equal(gw.status, "draining");
  assert.equal(gw.missed_streak, 10, "no double count on the owner's poll");
  assert.equal(notices.at(-1).kind, "gateway_quarantined");
  const stats = await ledgerStats(db);
  assert.ok(stats.queued_bulk >= 1, "expired leases requeued, not lost");
});

test("owner-first settlement charges the same (issue #6)", async () => {
  await db.query(`delete from job`);
  await db.query(
    `update gateway set missed_streak = 9 where name = 'abandon-owner'`,
  );
  await enqueueJob(db, { ...JOB, entity_key: "#ABN3" });
  const r = await door.lease(db, authed(TOKEN_ABANDON_OWNER), { wait_s: 0 });
  assert.equal(r.status, 200);
  await db.query(
    `update job set leased_at = now() - interval '10 minutes' where status = 'leased'`,
  );
  // Settlement runs on the scheduler tick since 2026-09-11, never per
  // lease call; the owner's own poll then reads the settled streak.
  await settleLeases(db);
  const quarantined = await door.lease(db, authed(TOKEN_ABANDON_OWNER), {
    wait_s: 0,
  });
  assert.equal(quarantined.status, 409);
  assert.equal((await gatewayRow("abandon-owner")).missed_streak, 10);
});

test("client version gate: parses real client strings, fails open on unknown", () => {
  // Clients report a build string, not a bare semver.
  assert.deepEqual(parseClientVersion("v2.0.19"), [2, 0, 19]);
  assert.deepEqual(parseClientVersion("py-v2.0.19"), [2, 0, 19]);
  assert.deepEqual(parseClientVersion("2.0.0"), [2, 0, 0]);
  // A local build names no version, and must not be judged as one.
  assert.equal(parseClientVersion("dev"), null);
  assert.equal(parseClientVersion("py-dev"), null);
  assert.equal(parseClientVersion(""), null);
  assert.equal(parseClientVersion(undefined), null);

  // The generation that predates the rename is below 2.0.0.
  assert.equal(clientMeetsMinimum("v0.1.16", "2.0.0"), false);
  assert.equal(clientMeetsMinimum("py-v0.1.17", "2.0.0"), false);
  // The current generation clears it, in both clients.
  assert.equal(clientMeetsMinimum("v2.0.19", "2.0.0"), true);
  assert.equal(clientMeetsMinimum("py-v2.0.19", "2.0.0"), true);
  // Exactly the minimum is allowed; "at least" is not "greater than".
  assert.equal(clientMeetsMinimum("2.0.0", "2.0.0"), true);
  // Ordering is numeric, not lexical: 10 > 9 even though "10" < "9".
  assert.equal(clientMeetsMinimum("v2.0.10", "2.0.9"), true);
  assert.equal(clientMeetsMinimum("v2.0.9", "2.0.10"), false);
  assert.equal(clientMeetsMinimum("v3.0.0", "2.9.9"), true);
  assert.equal(clientMeetsMinimum("v1.9.9", "2.0.0"), false);

  // FAIL OPEN. An unparseable version, on either side, is allowed
  // through: this gate retires stale clients, it does not authenticate
  // anyone, and a formatting slip must never become a fleet outage.
  assert.equal(clientMeetsMinimum("dev", "2.0.0"), true);
  assert.equal(clientMeetsMinimum("", "2.0.0"), true);
  assert.equal(clientMeetsMinimum("v2.0.19", "not-a-version"), true);
});

test("a too-old client is refused work but NEVER refused config", async (t) => {
  const stale = {
    ...authed(TOKEN_BULK),
    headers: {
      ...authed(TOKEN_BULK).headers,
      "x-collector-version": "v0.1.16",
    },
  };
  const current = {
    ...authed(TOKEN_BULK),
    headers: {
      ...authed(TOKEN_BULK).headers,
      "x-collector-version": "v2.0.30",
    },
  };

  // Off by default: the gate cannot bite until it is switched on.
  delete process.env.COLLECTOR_MIN_ENFORCE;
  assert.equal((await door.lease(db, stale, {})).status !== 426, true);

  process.env.COLLECTOR_MIN_ENFORCE = "1";
  t.after(() => delete process.env.COLLECTOR_MIN_ENFORCE);

  const leased = await door.lease(db, stale, {});
  assert.equal(leased.status, 426);
  assert.equal(leased.body.error, "client_too_old");
  assert.equal(leased.body.min_client_version, "2.0.30");

  const submitted = await door.submit(db, stale, { lease: 1 });
  assert.equal(submitted.status, 426);

  // The one route that must always answer: it is how a stale client
  // learns which binary to install. Locking it out here would strand
  // the collector permanently.
  const cfg = await door.config(db, stale);
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.update["go-darwin-arm64"].version, "2.0.0");

  // A current client is unaffected.
  assert.notEqual((await door.lease(db, current, {})).status, 426);
});

// --------------------------------------------------------------- #11
test("per-token request budgets are enforced, isolated, and recoverable", async () => {
  const acct = await db.query(`select account_id from account limit 1`);
  const mkGateway = async (name, token) => {
    await db.query(
      `insert into gateway (owner_account_id, name, token_hash, channel, status)
       values ($1, $2, $3, 'bulk', 'active')`,
      [acct.rows[0].account_id, name, sha256(token)],
    );
    return (await gatewayRow(name)).gateway_id;
  };
  const TOKEN_A = "emcg_budget_a";
  const TOKEN_B = "emcg_budget_b";
  const idA = await mkGateway("budget-a", TOKEN_A);
  await mkGateway("budget-b", TOKEN_B);

  // Config is the tight budget: a collector reads it on start and
  // refreshes hourly, so the cap is far above use but still bounds the
  // cheapest flood. Spend it directly rather than issuing 120 calls.
  const spend = (gatewayId, kind, n) =>
    db.query(
      `insert into rate_limit (bucket, window_start, count)
       values ($1, date_trunc('hour', now()), $2)
       on conflict (bucket, window_start) do update set count = $2`,
      [`collector-${kind}#${gatewayId}`, n],
    );

  // Just under: still served.
  await spend(idA, "config", 119);
  const ok = await door.config(db, authed(TOKEN_A));
  assert.equal(ok.status, 200, "the last call inside the budget is served");

  // Over: a structured refusal that tells the client when to return.
  const refused = await door.config(db, authed(TOKEN_A));
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, "rate_limited");
  assert.equal(refused.body.scope, "config");
  assert.equal(refused.body.limit_per_hour, 120);
  assert.ok(refused.body.retry_after_s > 0);
  assert.ok(refused.body.retry_after_s <= 3600);
  assert.equal(
    refused.headers["retry-after"],
    String(refused.body.retry_after_s),
    "the header and the body agree",
  );

  // Budgets are per TOKEN: exhausting one collector never touches
  // another, which is the whole point of a per-token budget.
  assert.equal((await door.config(db, authed(TOKEN_B))).status, 200);

  // And they are per SCOPE: a spent config budget does not stop the
  // collector doing its actual work.
  assert.notEqual(
    (await door.lease(db, authed(TOKEN_A), {})).status,
    429,
    "config exhaustion must not halt collection",
  );

  // The work budget stops leases and submits alike.
  await spend(idA, "work", 10_000);
  const leaseRefused = await door.lease(db, authed(TOKEN_A), {});
  assert.equal(leaseRefused.status, 429);
  assert.equal(leaseRefused.body.scope, "work");
  const submitRefused = await door.submit(db, authed(TOKEN_A), { lease: 1 });
  assert.equal(submitRefused.status, 429, "a refused submit is metered too");
  assert.equal((await door.lease(db, authed(TOKEN_B), {})).status, 200);

  // The window is fixed, not sliding: the next hour is a clean slate.
  await db.query(
    `update rate_limit set window_start = window_start - interval '1 hour'
     where bucket like 'collector-%#' || $1`,
    [idA],
  );
  assert.equal(
    (await door.config(db, authed(TOKEN_A))).status,
    200,
    "the budget recovers when the window rolls",
  );

  // An unauthenticated caller is refused before it can charge - or
  // choose - any bucket. Metering ahead of auth would let a stranger
  // fill the table with buckets of their own naming.
  const countBuckets = async () =>
    (
      await db.query(
        `select count(*)::int as n from rate_limit where bucket like 'collector-%'`,
      )
    ).rows[0].n;
  const before = await countBuckets();
  const anon = await door.config(db, authed("emcg_not_a_real_token"));
  assert.equal(anon.status, 401);
  assert.equal(
    await countBuckets(),
    before,
    "a refused caller charges nothing and creates no bucket",
  );
});
