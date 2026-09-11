/**
 * The sweep deletes rows. Nothing tested that it deletes the right ones.
 *
 * sweepPayloads retires a superseded api_payload row only once it has
 * confirmed the row's twin exists in S3, which makes the archive the system
 * of record for old content and Postgres the hot set. That guard is the
 * whole safety property, and it was unexercised -- including the s3override
 * parameter, an injection seam put there for a test that was never written.
 *
 * The failure this pins against is not hypothetical. The archive key is
 * rebuilt here from first_fetched_at, and the pipeline writes it from the
 * same column precisely so the two agree; they disagreed once already
 * (sol-6 finding 6) and every twin lookup missed. A miss is fail-safe -- the
 * row stays -- so the bug is SILENT, and the only thing that would surface
 * it is a test that watches which rows survive.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { sweepPayloads } from "../src/index.mjs";
import { archiveKey } from "../../ingest/src/pipeline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_sweep_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;

/** An S3 that only knows about the keys it was handed. */
function fakeS3(presentKeys) {
  const seen = new Set(presentKeys);
  const asked = [];
  return {
    asked,
    send(cmd) {
      const key = cmd.input.Key;
      asked.push(key);
      if (!seen.has(key)) return Promise.reject(new Error("NotFound"));
      return Promise.resolve({});
    },
  };
}

async function payload(endpoint, entity, hash, firstFetched, lastFetched) {
  const { rows } = await db.query(
    `insert into api_payload
       (endpoint, entity_key, payload_hash, payload_json, first_fetched_at, last_fetched_at)
     values ($1, $2, $3, '{}'::jsonb, $4, $5) returning payload_id, first_fetched_at`,
    [endpoint, entity, hash, firstFetched, lastFetched],
  );
  return rows[0];
}

const liveIds = async () =>
  (
    await db.query(`select payload_id from api_payload order by payload_id`)
  ).rows.map((r) => Number(r.payload_id));

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
  process.env.ARCHIVE_BUCKET = "test-archive";
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("a superseded row is retired only once its twin is confirmed", async () => {
  const old = await payload(
    "player",
    "#20JJJ2CCRU",
    "a".repeat(64),
    "2026-09-01T10:00:00Z",
    "2026-09-01T10:00:00Z",
  );
  const current = await payload(
    "player",
    "#20JJJ2CCRU",
    "b".repeat(64),
    "2026-09-02T10:00:00Z",
    "2026-09-02T10:00:00Z",
  );
  const key = archiveKey(
    "player",
    "#20JJJ2CCRU",
    old.first_fetched_at.toISOString(),
    "a".repeat(64),
  );
  const s3 = fakeS3([key]);

  const r = await sweepPayloads(DB_URL, s3);
  assert.deepEqual(
    { candidates: r.candidates, swept: r.swept, missing: r.missing },
    { candidates: 1, swept: 1, missing: 0 },
  );
  assert.deepEqual(
    await liveIds(),
    [Number(current.payload_id)],
    "the hot row survives; only the superseded one goes",
  );
});

test("the cache window: JSON older than two days is nulled once S3 has it; fresh rows keep theirs", async () => {
  await db.query(`delete from api_payload`);
  const old = await payload(
    "player",
    "#OLD",
    "c".repeat(64),
    "2026-09-01T10:00:00Z",
    "2026-09-01T10:00:00Z",
  );
  const fresh = await payload(
    "player",
    "#FRESH",
    "d".repeat(64),
    new Date().toISOString(),
    new Date().toISOString(),
  );
  const orphan = await payload(
    "player",
    "#ORPHAN",
    "e".repeat(64),
    "2026-09-01T10:00:00Z",
    "2026-09-01T10:00:00Z",
  );
  const s3 = fakeS3([
    archiveKey(
      "player",
      "#OLD",
      old.first_fetched_at.toISOString(),
      "c".repeat(64),
    ),
  ]);
  const r = await sweepPayloads(DB_URL, s3);
  assert.deepEqual(
    {
      swept: r.swept,
      stale: r.stale,
      cleared: r.cleared,
      unarchived: r.unarchived,
    },
    { swept: 0, stale: 2, cleared: 1, unarchived: 1 },
  );
  const { rows } = await db.query(
    `select entity_key, payload_json is null as cleared from api_payload order by payload_id`,
  );
  assert.deepEqual(rows, [
    { entity_key: "#OLD", cleared: true },
    { entity_key: "#FRESH", cleared: false },
    { entity_key: "#ORPHAN", cleared: false },
  ]);
  assert.deepEqual(
    await liveIds(),
    [old.payload_id, fresh.payload_id, orphan.payload_id].map(Number),
    "the window nulls JSON; it never deletes a latest row",
  );
});

test("no twin, no delete -- and the miss is reported rather than swallowed", async () => {
  // The safety property. A key mismatch between the writer and this reader
  // lands here, and because it is fail-safe it is silent in production: the
  // only signal is `missing` climbing while `swept` stays flat.
  await db.query(`delete from api_payload`);
  const orphan = await payload(
    "clan",
    "#J2RGCRVG",
    "c".repeat(64),
    "2026-09-01T10:00:00Z",
    "2026-09-01T10:00:00Z",
  );
  await payload(
    "clan",
    "#J2RGCRVG",
    "d".repeat(64),
    "2026-09-02T10:00:00Z",
    "2026-09-02T10:00:00Z",
  );

  const r = await sweepPayloads(DB_URL, fakeS3([])); // S3 knows nothing
  assert.equal(r.missing, 1);
  assert.equal(r.swept, 0);
  assert.ok(
    (await liveIds()).includes(Number(orphan.payload_id)),
    "a row whose twin cannot be confirmed MUST survive",
  );
});

test("the key is rebuilt from first_fetched_at, matching what the writer used", async () => {
  // The two must agree or every lookup misses. Asserting the exact key the
  // sweep asks for is what would have caught sol-6 finding 6.
  await db.query(`delete from api_payload`);
  const old = await payload(
    "player_battlelog",
    "#9U82PLQ",
    "e".repeat(64),
    "2026-09-01T08:15:30Z", // first fetch
    "2026-09-03T11:00:00Z", // last fetch -- deliberately different
  );
  await payload(
    "player_battlelog",
    "#9U82PLQ",
    "f".repeat(64),
    "2026-09-04T10:00:00Z",
    "2026-09-04T10:00:00Z",
  );
  const s3 = fakeS3([]);
  await sweepPayloads(DB_URL, s3);
  assert.equal(
    s3.asked[0],
    archiveKey(
      "player_battlelog",
      "#9U82PLQ",
      old.first_fetched_at.toISOString(),
      "e".repeat(64),
    ),
  );
  assert.ok(
    s3.asked[0].includes("dt=2026-09-01"),
    `keyed on the FIRST fetch, not the last: ${s3.asked[0]}`,
  );
});

test("a row with no newer version is never a candidate", async () => {
  // The hot set is what serves reads; only superseded content is archived.
  await db.query(`delete from api_payload`);
  await payload(
    "cards",
    "GLOBAL",
    "9".repeat(64),
    "2026-09-01T10:00:00Z",
    "2026-09-01T10:00:00Z",
  );
  const r = await sweepPayloads(DB_URL, fakeS3([]));
  assert.equal(r.candidates, 0);
  assert.equal((await liveIds()).length, 1);
});

/**
 * sweepOperational deletes from seven tables and redacts two more, and
 * nothing exercised any of it.
 *
 * Every statement is a bare interval against now(), so the risk is not a
 * crash -- it is a wrong number silently deleting a window it should have
 * kept, or keeping one it should have dropped. Neither shows up anywhere:
 * the job returns counts nobody compares against an expectation.
 *
 * Each case below puts one row just INSIDE its retention window and one just
 * outside, so a changed interval fails here rather than in production.
 */
import { sweepOperational } from "../src/index.mjs";

const count = async (t) =>
  Number((await db.query(`select count(*)::int n from ${t}`)).rows[0].n);

test("each retention window keeps what is inside it and drops what is not", async () => {
  const acct = (
    await db.query(
      `insert into account (email_hash, status) values ('sweep-test', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;

  await db.query(
    `insert into rate_limit (bucket, window_start, count) values
       ('keep', (now() - interval '6 days')::date, 1),
       ('drop', (now() - interval '8 days')::date, 1)`,
  );
  await db.query(
    `insert into event_feed (account_id, topic, created_at) values
       ($1, 'battles_recorded', now() - interval '29 days'),
       ($1, 'battles_recorded', now() - interval '31 days')`,
    [acct],
  );

  const out = await sweepOperational(DB_URL);

  assert.equal(out.rate_limit, 1, "only the 8-day-old rate_limit row");
  assert.equal(await count("rate_limit"), 1);
  assert.equal(out.event_feed, 1, "only the 31-day-old event");
  assert.equal(await count("event_feed"), 1);
});

test("the feed prune does not spare unread notifications", async () => {
  // Worth pinning as a DECISION rather than leaving as an accident: the feed
  // is operational, not archival (0030), so an agent that stops polling for a
  // month loses what it never read. If that is ever wrong, this test is where
  // the argument happens.
  const acct = (
    await db.query(
      `insert into account (email_hash, status, events_seen_through)
       values ('sweep-unread', 'approved', 0) returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into event_feed (account_id, topic, created_at)
     values ($1, 'member_joined', now() - interval '31 days')`,
    [acct],
  );
  const before = await count("event_feed");
  await sweepOperational(DB_URL);
  assert.equal(
    await count("event_feed"),
    before - 1,
    "unread and old is still pruned",
  );
});

test("an expired collector bearer is nulled, not merely made unclaimable", async () => {
  // It is a live credential sitting in plaintext; past its window it was
  // already unclaimable (#31), and this stops it being readable too.
  const owner = (
    await db.query(
      `insert into account (email_hash, status) values ('sweep-gw', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status,
                          provision_env, provision_expires_at)
     values ($1, 'expired-gw', '127.0.0.2', 'pending', 'TOKEN=secret',
             now() - interval '1 hour')`,
    [owner],
  );
  await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status,
                          provision_env, provision_expires_at)
     values ($1, 'live-gw', '127.0.0.3', 'pending', 'TOKEN=secret',
             now() + interval '1 hour')`,
    [owner],
  );

  const out = await sweepOperational(DB_URL);
  assert.equal(out.provision_env_expired, 1);
  const { rows } = await db.query(
    `select name, provision_env from gateway order by name`,
  );
  assert.equal(rows.find((r) => r.name === "expired-gw").provision_env, null);
  assert.ok(
    rows.find((r) => r.name === "live-gw").provision_env,
    "a bearer still inside its window survives",
  );
});

test("captured bodies expire on the same 90-day clock as the arguments", async () => {
  const acct = (
    await db.query(
      `insert into account (email_hash, status) values ('sweep-capture', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into mcp_call_audit (account_id, tool, captured, created_at) values
       ($1, 'war_current', true, now() - interval '89 days'),
       ($1, 'war_current', true, now() - interval '91 days'),
       ($1, 'war_current', false, now() - interval '91 days')`,
    [acct],
  );
  const out = await sweepOperational(DB_URL);
  assert.equal(
    out.audit_capture_expired,
    1,
    "only the captured row past 90 days",
  );
  const { rows } = await db.query(
    `select captured from mcp_call_audit where account_id = $1 order by created_at desc`,
    [acct],
  );
  assert.deepEqual(
    rows.map((r) => r.captured),
    [true, false, false],
    "inside the window stays captured; outside is released",
  );
});
