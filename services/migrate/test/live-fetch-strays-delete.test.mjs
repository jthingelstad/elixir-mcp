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
 * 0210 deletes what the pre-0209 live_fetch path recorded for two
 * untracked players (Jamie, 2026-10-08), scoped by tag literal. The test
 * reads the tags out of the migration itself, seeds their admissions and
 * a tracked neighbour, and runs the file as the migrate runner does: only
 * the two footprints go, a re-run deletes nothing, and a tag that became
 * recorded stops the file before it deletes anything.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const FILE = path.join(
  repoRoot,
  "db/migrations/0210_live_fetch_strays_delete.sql",
);
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_strays_delete_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const NEIGHBOUR = "#2QQ0V9QQ";

let db;
let gatewayId;
let accountId;
let sql;
let strays;
let base;

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
  sql = await readFile(FILE, "utf8");
  strays = [...new Set(sql.match(/'#[0-9A-Z]+'/g).map((s) => s.slice(1, -1)))];
  base = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/player/profile.json"), "utf8"),
  );
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status) values ('strays-delete', 'approved') returning account_id`,
  );
  accountId = a.account_id;
  const {
    rows: [g],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status, channel)
     values ($1, 'strays-delete-gw', '127.0.0.1', 'active', 'live') returning gateway_id`,
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

/** A profile admission, as the pre-0209 live_fetch (or a poll) made it. */
async function admit(tag, lane) {
  const profile = { ...structuredClone(base), tag };
  const job = await enqueueJob(db, {
    endpoint: "player",
    entity_key: tag,
    lane,
  });
  const outcome = await processResult(db, {
    v: 1,
    job: { endpoint: "player", entity_key: tag, lane },
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

/** The migrate runner's shape: one transaction around the file. */
async function runFile() {
  await db.query("begin");
  try {
    await db.query(sql);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

const census = async (tags) =>
  (await tagFootprintCensus(SCRATCH_URL, { tags }, { head: async () => true }))
    .tags;

function total(rows) {
  return Object.values(rows).reduce(
    (n, v) =>
      n +
      (typeof v === "number" ? v : Object.values(v).reduce((a, b) => a + b, 0)),
    0,
  );
}

test("0210 names two tags and deletes only their footprint, idempotently", async () => {
  assert.equal(strays.length, 2, "two tag literals");
  for (const tag of strays) await admit(tag, "live");
  await admit(NEIGHBOUR, "live");
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'unverified', true)`,
    [accountId, NEIGHBOUR],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, origin, scope)
     values ('player', $1, $2, 'claim', 'comprehensive')`,
    [NEIGHBOUR, accountId],
  );
  const before = await census([...strays, NEIGHBOUR]);
  for (const s of before.slice(0, 2)) {
    assert.ok(s.rows["player_card.player_tag"] > 0, `${s.tag} has cards`);
    assert.ok(s.rows["player_badge.player_tag"] > 0, `${s.tag} has badges`);
    assert.deepEqual(s.rows["api_receipt.entity_key"], { player: 1 });
    assert.deepEqual(s.rows["api_payload.entity_key"], { player: 1 });
  }
  const neighbourBefore = before[2];
  const {
    rows: [{ n: clansBefore }],
  } = await db.query(`select count(*)::int as n from clan`);

  await runFile();
  const afterOnce = await census([...strays, NEIGHBOUR]);
  for (const s of afterOnce.slice(0, 2)) {
    assert.equal(s.player, null, `${s.tag}'s player row went`);
    // Only the operational job row is left: the ledger prunes it.
    const left = { ...s.rows };
    assert.deepEqual(left["job.entity_key"], { player: 1 });
    delete left["job.entity_key"];
    assert.equal(total(left), 0, `${s.tag}: ${JSON.stringify(left)}`);
  }
  assert.deepEqual(afterOnce[2], neighbourBefore, "the neighbour is untouched");
  const {
    rows: [{ n: clansAfter }],
  } = await db.query(`select count(*)::int as n from clan`);
  assert.equal(clansAfter, clansBefore, "clan rows stay");

  await runFile();
  assert.deepEqual(
    await census([...strays, NEIGHBOUR]),
    afterOnce,
    "a re-run deletes nothing",
  );
});

test("0210 stops before deleting anything if a tag has become recorded", async () => {
  const [tag] = strays;
  await admit(tag, "live");
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, origin, scope)
     values ('player', $1, $2, 'claim', 'comprehensive')`,
    [tag, accountId],
  );
  const [held] = await census([tag]);
  await assert.rejects(runFile(), /a tag is recorded now \(active recording\)/);
  const [still] = await census([tag]);
  assert.deepEqual(still.rows, held.rows, "nothing deleted");
});
