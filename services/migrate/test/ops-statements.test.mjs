/**
 * What issue #71 asks the database to
 * show: {statements} reads pg_stat_statements (0190), and {tables} shows
 * each table's visibility-map cover and the autovacuum settings 0189 put
 * on the meta readers' tables, which is how the week-later check reads.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { statements, tables } from "../src/ops-diagnostics.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_statements_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;
before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db?.end();
  await dropScratch(SCRATCH);
});

const TUNED = ["deck"];

test("0189 autovacuum tuning remains on the deck table", async () => {
  const { rows } = await db.query(
    `select relname, reloptions from pg_class
      where relname = any($1) and relkind = 'r'`,
    [TUNED],
  );
  assert.equal(rows.length, TUNED.length);
  for (const r of rows)
    assert.deepEqual(
      [...r.reloptions].sort(),
      [
        "autovacuum_analyze_scale_factor=0.02",
        "autovacuum_vacuum_insert_scale_factor=0.02",
        "autovacuum_vacuum_scale_factor=0.05",
      ],
      r.relname,
    );
});

test("0253 vacuums the battle and snapshot tables after a fixed count of inserts", async () => {
  const { rows } = await db.query(
    `select relname, reloptions from pg_class
      where relname = any($1) and relkind = 'r' order by relname`,
    [["battle", "battle_participant", "player_snapshot_daily"]],
  );
  const options = Object.fromEntries(
    rows.map((r) => [r.relname, [...(r.reloptions ?? [])].sort()]),
  );
  const fixed = (threshold) => [
    "autovacuum_vacuum_insert_scale_factor=0",
    `autovacuum_vacuum_insert_threshold=${threshold}`,
  ];
  // 0103's dead-tuple and analyze settings stay on the battle tables.
  const from0103 = [
    "autovacuum_analyze_scale_factor=0.02",
    "autovacuum_vacuum_scale_factor=0.05",
  ];
  assert.deepEqual(options, {
    battle: [...from0103, ...fixed(500)].sort(),
    battle_participant: [...from0103, ...fixed(1000)].sort(),
    player_snapshot_daily: fixed(500),
  });
});

test("{tables} shows each table's visibility-map cover and its storage options", async () => {
  await db.query(`vacuum (analyze) deck`);
  const result = await tables(SCRATCH_URL);
  const deck = result.tables.find((t) => t.table_name === "deck");
  assert.ok(deck, "deck is listed");
  assert.equal(typeof deck.pages, "number");
  assert.equal(typeof deck.all_visible_pages, "number");
  // An empty table has no pages, so no fraction to report.
  assert.equal(deck.all_visible_pct, deck.pages > 0 ? 100 : null);
  assert.ok(
    deck.table_options.includes("autovacuum_vacuum_insert_scale_factor=0.02"),
  );
});

test("0190 installs pg_stat_statements, and {statements} answers without failing where it is not preloaded", async () => {
  const { rows } = await db.query(
    `select 1 from pg_extension where extname = 'pg_stat_statements'`,
  );
  assert.equal(rows.length, 1);
  const { rows: preload } = await db.query(`show shared_preload_libraries`);
  const loaded = /\bpg_stat_statements\b/.test(
    preload[0].shared_preload_libraries,
  );
  const result = await statements(SCRATCH_URL, { limit: 500 });
  if (!loaded) {
    assert.deepEqual(result, { error: "not_loaded" });
    return;
  }
  // RDS preloads it: the ranked shape, clamped to 50.
  assert.equal(result.limit, 50);
  assert.ok(Array.isArray(result.by_total_time));
  assert.ok(Array.isArray(result.by_shared_blks_read));
  for (const s of result.by_total_time) {
    assert.equal(typeof s.calls, "number");
    assert.ok(s.query.length <= 400);
  }
});

test("{statements} before 0190 says the extension is not installed", async () => {
  await db.query(`drop extension pg_stat_statements`);
  try {
    assert.deepEqual(await statements(SCRATCH_URL), {
      error: "not_installed",
    });
  } finally {
    await db.query(`create extension pg_stat_statements`);
  }
});
