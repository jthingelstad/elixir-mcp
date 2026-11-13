/**
 * {rewrite_table}: VACUUM FULL of one table from a closed list. The list
 * grew on 2026-11-13 from 0097's three dropped-column tables to the
 * tables the 2026-10-07 purge left with dead space. Pinned here: every
 * listed table exists and answers sizes before and after, any other name
 * is refused before connecting, and the lock and statement timeouts end
 * a rewrite that cannot run instead of letting it hold the table.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { rewriteTable, REWRITE_TIMEOUTS } from "../src/deck-backfill.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_rewrite_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
// A refusal throws before connecting; this URL proves it.
const NOWHERE = "postgres://nobody@127.0.0.1:1/none";

const REWRITABLE = [
  "battle_participant",
  "battle_participant_card",
  "deck_card",
  "battle",
  "battle_participant_round",
  "deck",
  "player",
  "player_snapshot_daily",
  "player_daily_battle_rollup",
  "player_badge",
  "api_receipt",
  "mcp_call_audit",
  "capture_audit",
  "job",
];

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

test("the timeouts keep a rewrite inside the 300 s migrate Lambda", () => {
  assert.equal(REWRITE_TIMEOUTS.statementMs, 240_000);
  assert.equal(REWRITE_TIMEOUTS.lockMs, 10_000);
});

test("every listed table is rewritten and reports its sizes before and after", async () => {
  for (const table of REWRITABLE) {
    const out = await rewriteTable(SCRATCH_URL, { table });
    assert.equal(out.error, undefined, `${table}: ${out.message}`);
    assert.equal(out.table, table);
    for (const side of ["before", "after"]) {
      for (const key of ["bytes", "heap", "indexes", "rows"])
        assert.notEqual(out[side][key], undefined, `${table} ${side}.${key}`);
    }
    assert.equal(typeof out.freed_bytes, "number");
    assert.deepEqual(out.timeouts, {
      statement_timeout_ms: 240_000,
      lock_timeout_ms: 10_000,
    });
  }
  // The bare-string form the op has always taken.
  const bare = await rewriteTable(SCRATCH_URL, "player_badge");
  assert.equal(bare.table, "player_badge");
});

test("any other name is refused before connecting", async () => {
  for (const spec of [
    { table: "account" },
    { table: "player; drop table player" },
    { table: "" },
    {},
    undefined,
    "clan_event",
  ]) {
    await assert.rejects(
      rewriteTable(NOWHERE, spec),
      /rewrite_table: not one of/,
    );
  }
});

test("a lock it cannot get in time ends the rewrite and leaves the table", async () => {
  const holder = new pg.Client({ connectionString: SCRATCH_URL });
  await holder.connect();
  try {
    await holder.query("begin");
    await holder.query("lock table player_badge in access share mode");
    const out = await rewriteTable(
      SCRATCH_URL,
      { table: "player_badge" },
      { statementMs: 30_000, lockMs: 200 },
    );
    assert.equal(out.error, "rewrite_failed");
    assert.equal(out.code, "55P03");
    assert.ok(out.before.bytes !== undefined);
    assert.deepEqual(out.timeouts, {
      statement_timeout_ms: 30_000,
      lock_timeout_ms: 200,
    });
  } finally {
    await holder.query("rollback").catch(() => {});
    await holder.end();
  }
});

test("the statement timeout ends a rewrite that would outlive the Lambda", async () => {
  const holder = new pg.Client({ connectionString: SCRATCH_URL });
  await holder.connect();
  try {
    await holder.query("begin");
    await holder.query("lock table job in access share mode");
    const out = await rewriteTable(
      SCRATCH_URL,
      { table: "job" },
      { statementMs: 200, lockMs: 30_000 },
    );
    assert.equal(out.error, "rewrite_failed");
    assert.equal(out.code, "57014");
  } finally {
    await holder.query("rollback").catch(() => {});
    await holder.end();
  }
});
