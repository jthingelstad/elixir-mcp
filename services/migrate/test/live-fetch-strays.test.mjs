import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { liveFetchStrayCensus } from "../src/ops-diagnostics.mjs";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { enqueueJob } from "../../../packages/ledger/src/ledger.mjs";

/**
 * {live_fetch_strays} (0209): before 0209 a live_fetch of a player was
 * projected like any poll, so a player nobody tracks could enter the
 * record. The census names, for each player tag live_fetch read, whether
 * anyone tracks it and, if not, what the profile admission left behind.
 * Read-only.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_live_strays_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;
let gatewayId;
let accountId;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status) values ('strays', 'approved') returning account_id`,
  );
  accountId = a.account_id;
  const {
    rows: [g],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status, channel)
     values ($1, 'strays-gw', '127.0.0.1', 'active', 'live') returning gateway_id`,
    [accountId],
  );
  gatewayId = g.gateway_id;
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

/** A pre-0209 live_fetch: a recorded live-lane admission and its call. */
async function liveFetchedBefore0209(profile) {
  const job = await enqueueJob(db, {
    endpoint: "player",
    entity_key: profile.tag,
    lane: "live",
  });
  const outcome = await processResult(db, {
    v: 1,
    job: { endpoint: "player", entity_key: profile.tag, lane: "live" },
    job_id: Number(job.job_id),
    gateway_id: gatewayId,
    fetched_at: new Date().toISOString(),
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(profile))).toString(
      "base64",
    ),
  });
  assert.equal(outcome.outcome, "admitted");
  await db.query(
    `insert into mcp_call_audit (account_id, tool, request_id, args)
     values ($1, 'live_fetch', gen_random_uuid(), $2)`,
    [accountId, { path: `/players/${encodeURIComponent(profile.tag)}` }],
  );
}

test("live_fetch_strays names untracked players live_fetch recorded, and what they left", async () => {
  const base = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/player/profile.json"), "utf8"),
  );
  const stray = { ...structuredClone(base), tag: "#2QQ0V9PP" };
  const claimed = { ...structuredClone(base), tag: "#2QQ0V9QQ" };
  await liveFetchedBefore0209(stray);
  await liveFetchedBefore0209(claimed);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'unverified', true)`,
    [accountId, claimed.tag],
  );
  const census = await liveFetchStrayCensus(SCRATCH_URL, { days: 7 });
  assert.equal(census.tags_read, 2);
  assert.equal(census.tracked, 1, "a claimed player is not a stray");
  assert.equal(census.untracked.length, 1);
  const [row] = census.untracked;
  assert.equal(row.tag, stray.tag);
  assert.equal(row.live_fetch_calls, 1);
  assert.ok(row.footprint.player_snapshot_daily > 0, "the snapshot");
  assert.ok(row.footprint.player_card > 0, "the collection");
  assert.equal(row.battle_participant, 0);
  assert.deepEqual(
    row.receipts.map((r) => [r.lane, r.record, r.n]),
    [["live", "true", 1]],
  );
  // A tag given that nothing read is reported with an empty footprint.
  const given = await liveFetchStrayCensus(SCRATCH_URL, {
    days: 1,
    tags: ["#2QQ0V9RR"],
  });
  const none = given.untracked.find((u) => u.tag === "#2QQ0V9RR");
  assert.equal(none.footprint.player_snapshot_daily, 0);
  assert.equal(none.player_first_seen_at, null);
});
