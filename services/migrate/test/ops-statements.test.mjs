/**
 * What issue #71 (review 2026-09-27 §5.2, §5.3) asks the database to
 * show: {statements} reads pg_stat_statements (0190), and {tables} shows
 * each table's visibility-map cover and the autovacuum settings 0189 put
 * on the meta readers' tables, which is how the week-later check reads.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { statements, tables } from "../src/ops-diagnostics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_statements_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;
before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

const TUNED = [
  "deck",
  "deck_card",
  "meta_season_pop",
  "battle_participant_card",
  "card_meta_season",
  "card_meta_season_band",
  "deck_meta_season",
  "deck_meta_season_band",
  "meta_season_totals",
  "meta_season_band_totals",
];

test("0189 tunes autovacuum on the meta readers' tables as 0103 did the battle tables", async () => {
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

test("{tables} shows each table's visibility-map cover and its storage options", async () => {
  await db.query(`vacuum (analyze) deck_card`);
  const result = await tables(SCRATCH_URL);
  const deckCard = result.tables.find((t) => t.table_name === "deck_card");
  assert.ok(deckCard, "deck_card is listed");
  assert.equal(typeof deckCard.pages, "number");
  assert.equal(typeof deckCard.all_visible_pages, "number");
  // An empty table has no pages, so no fraction to report.
  assert.equal(deckCard.all_visible_pct, deckCard.pages > 0 ? 100 : null);
  assert.ok(
    deckCard.table_options.includes(
      "autovacuum_vacuum_insert_scale_factor=0.02",
    ),
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
