import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { tagFootprintCensus } from "../src/ops-diagnostics.mjs";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { enqueueJob } from "../../../packages/ledger/src/ledger.mjs";

/**
 * {tag_footprint}: everything the database holds for a player tag, read
 * before and after a deletion Jamie approved. Read-only.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_tag_footprint_${process.pid}`;
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
    `insert into account (email_hash, status) values ('footprint', 'approved') returning account_id`,
  );
  accountId = a.account_id;
  const {
    rows: [g],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status, channel)
     values ($1, 'footprint-gw', '127.0.0.1', 'active', 'live') returning gateway_id`,
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

async function admitProfile(profile) {
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
}

test("tag_footprint counts every tag-keyed table and what makes a tag tracked", async () => {
  const base = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/player/profile.json"), "utf8"),
  );
  const stray = { ...structuredClone(base), tag: "#2QQ0V9PP" };
  const claimed = { ...structuredClone(base), tag: "#2QQ0V9QQ" };
  await admitProfile(stray);
  await admitProfile(claimed);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'unverified', true)`,
    [accountId, claimed.tag],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, tool, request_id, args)
     values ($1, 'live_fetch', gen_random_uuid(), $2)`,
    [accountId, { path: `/players/${encodeURIComponent(stray.tag)}` }],
  );
  const heads = [];
  const census = await tagFootprintCensus(
    SCRATCH_URL,
    { tags: [stray.tag, claimed.tag, "2QQ0V9PP"] },
    {
      head: async (key) => {
        heads.push(key);
        return true;
      },
    },
  );
  assert.equal(census.tags.length, 2, "tags are normalized and deduplicated");
  assert.ok(census.tag_columns.includes("player_card.player_tag"));
  assert.ok(census.tag_columns.includes("api_receipt.entity_key"));
  const [s, c] = census.tags;
  assert.equal(s.tag, stray.tag);
  assert.equal(s.player.named, true);
  assert.ok(s.rows["player_card.player_tag"] > 0, "the collection");
  assert.ok(s.rows["player_snapshot_daily.player_tag"] > 0, "the snapshot");
  assert.deepEqual(s.rows["api_receipt.entity_key"], { player: 1 });
  assert.equal(s.tracking.claims, 0);
  assert.deepEqual(s.tracking.recordings, []);
  assert.equal(s.battles.participant_rows, 0);
  assert.deepEqual(
    s.mcp_calls.map((x) => [x.tool, x.n]),
    [["live_fetch", 1]],
  );
  assert.equal(s.receipts.length, 1);
  assert.equal(s.receipts[0].lane, "live");
  assert.equal(s.receipts[0].archive_object, true);
  assert.match(
    s.receipts[0].archive_key,
    /^payloads\/endpoint=player\/entity=2QQ0V9PP\//,
  );
  assert.equal(c.tracking.claims, 1, "the claimed neighbour reads as tracked");
  assert.equal(heads.length, 2);
  // Nothing was written.
  const {
    rows: [n],
  } = await db.query(
    `select count(*)::int as n from player_card where player_tag = $1`,
    [stray.tag],
  );
  assert.equal(n.n, s.rows["player_card.player_tag"]);
});

test("tag_footprint refuses an empty or malformed tag list", async () => {
  assert.equal(
    (await tagFootprintCensus(SCRATCH_URL, {})).error,
    "tags_required",
  );
  assert.equal(
    (await tagFootprintCensus(SCRATCH_URL, { tags: ["not a tag!"] })).error,
    "invalid_tag",
  );
});
