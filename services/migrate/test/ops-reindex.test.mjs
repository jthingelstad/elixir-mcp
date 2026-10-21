/**
 * {reindex} (ops-reindex.mjs, 2026-10-21, #630): the report, one
 * concurrent rebuild of a bloated `battle` index, the leftover a
 * cancelled rebuild leaves and its drop, and every refusal. The bloat is
 * made the way production's was: rows inserted, then most deleted, so
 * the indexes keep their pages.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import {
  REINDEX_TIMEOUTS,
  estimateBtreeBytes,
  reindex,
} from "../src/ops-reindex.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_reindex_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
// A refusal returns before connecting; this URL proves it.
const NOWHERE = "postgres://nobody@127.0.0.1:1/none";

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
  // 60,000 battles, then nine in ten deleted: the indexes keep the pages
  // the deleted rows held, as battle's did after the bulk deletions.
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     select 'B' || lpad(g::text, 9, '0'),
            timestamptz '2026-10-01' + g * interval '7 seconds',
            'PvP', 'pvp',
            timestamptz '2026-10-01' + g * interval '7 seconds'
       from generate_series(1, 60000) g`,
  );
  await db.query(`delete from battle where cursor % 10 <> 0`);
  await db.query(`vacuum (analyze) battle`);
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

const sizeOf = async (name) =>
  Number(
    (await db.query(`select pg_relation_size($1::regclass) as b`, [name]))
      .rows[0].b,
  );

test("refusals that need no database answer before connecting", async () => {
  for (const [spec, error] of [
    [true, "unknown_table"],
    [{}, "unknown_table"],
    [{ table: "battle_participant" }, "unknown_table"],
    [{ table: "Battle" }, "unknown_table"],
    [{ table: "battle", aply: true }, "unknown_keys"],
    [{ table: "battle", apply: true }, "index_required"],
    [{ table: "battle", index: "", apply: true }, "index_required"],
    [{ table: "battle", index: "battle_pkey" }, "apply_required"],
    [
      { table: "battle", index: "battle_pkey", apply: false },
      "apply_must_be_true",
    ],
    [
      { table: "battle", apply: "yes", index: "battle_pkey" },
      "apply_must_be_true",
    ],
    [{ table: "battle", drop_invalid: "" }, "index_required"],
    [
      { table: "battle", index: "battle_pkey", apply: true, drop_invalid: "x" },
      "one_action",
    ],
  ])
    assert.equal(
      (await reindex(NOWHERE, spec)).error,
      error,
      JSON.stringify(spec),
    );
});

test("the timeouts sit under the migrate Lambda's", () => {
  const template = readFileSync(
    path.join(repoRoot, "infra/template.yaml"),
    "utf8",
  );
  const fn = template.slice(template.indexOf("  MigrateFunction:"));
  const lambdaS = Number(/\n {6}Timeout: (\d+)/.exec(fn)[1]);
  const pgoptionsS = Number(/statement_timeout=(\d+)s/.exec(fn)[1]);
  assert.equal(lambdaS, 300, "the migrate Lambda's timeout moved; recheck");
  // A minute for the connect, the reads around the rebuild and the reply.
  assert.ok(REINDEX_TIMEOUTS.statementMs <= (lambdaS - 60) * 1000);
  assert.ok(REINDEX_TIMEOUTS.statementMs < pgoptionsS * 1000);
  assert.ok(REINDEX_TIMEOUTS.lockMs < REINDEX_TIMEOUTS.statementMs);
});

test("the report reads every index, what it backs and its bloat", async () => {
  const before = await sizeOf("battle_pkey");
  const r = await reindex(SCRATCH_URL, { table: "battle" });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.table, "battle");
  assert.equal(r.row_estimate, 6000);
  assert.ok(r.heap_bytes > 0 && r.index_bytes > 0);
  assert.deepEqual(r.indexes.map((i) => i.name).sort(), [
    "battle_created_at",
    "battle_cursor_key",
    "battle_metadata_cover",
    "battle_pkey",
    "battle_time_idx",
  ]);
  const by = Object.fromEntries(r.indexes.map((i) => [i.name, i]));
  assert.deepEqual(by.battle_pkey.backs_constraint, {
    name: "battle_pkey",
    type: "primary_key",
  });
  assert.deepEqual(by.battle_pkey.foreign_keys, [
    "battle_participant_battle_id_fkey",
    "player_event_battle_id_fkey",
  ]);
  assert.deepEqual(by.battle_cursor_key.backs_constraint, {
    name: "battle_cursor_key",
    type: "unique",
  });
  assert.equal(by.battle_time_idx.backs_constraint, null);
  for (const i of r.indexes) {
    assert.equal(i.valid, true, i.name);
    assert.equal(i.leftover, null, i.name);
    assert.equal(typeof i.bytes, "number");
    assert.ok(i.scans === null || typeof i.scans === "number");
  }
  // Nine rows in ten are gone; the indexes still hold their pages.
  assert.ok(
    by.battle_pkey.bloat_estimate.excess_pct > 70,
    JSON.stringify(by.battle_pkey.bloat_estimate),
  );
  assert.deepEqual(r.invalid_indexes, []);
  assert.deepEqual(
    r.rebuild.statement_timeout_ms,
    REINDEX_TIMEOUTS.statementMs,
  );
  // It wrote nothing.
  assert.equal(await sizeOf("battle_pkey"), before);
});

test("an index that is not the table's, or not anywhere, is refused", async () => {
  const other = await reindex(SCRATCH_URL, {
    table: "battle",
    index: "battle_participant_player",
    apply: true,
  });
  assert.equal(other.error, "index_not_on_table");
  assert.ok(other.indexes.includes("battle_pkey"));
  assert.equal(
    (
      await reindex(SCRATCH_URL, {
        table: "battle",
        index: "no_such_index",
        apply: true,
      })
    ).error,
    "unknown_index",
  );
  assert.equal(
    (
      await reindex(SCRATCH_URL, {
        table: "battle",
        drop_invalid: "battle_participant_player",
      })
    ).error,
    "index_not_on_table",
  );
});

test("a bloated index is rebuilt concurrently, valid and smaller, and keeps its foreign keys", async () => {
  const before = await sizeOf("battle_pkey");
  const r = await reindex(SCRATCH_URL, {
    table: "battle",
    index: "battle_pkey",
    apply: true,
  });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.action, "reindex_concurrently");
  assert.equal(r.before.bytes, before);
  assert.equal(r.after.valid, true);
  assert.ok(r.after.bytes < before / 4, JSON.stringify(r));
  assert.equal(r.freed_bytes, before - r.after.bytes);
  assert.equal(r.after.bytes, await sizeOf("battle_pkey"));
  assert.ok(r.ms >= 0);
  assert.deepEqual(r.invalid_indexes, []);
  // The primary key and both foreign keys now use the rebuilt index.
  const { rows } = await db.query(
    `select conname from pg_constraint
      where conindid = 'battle_pkey'::regclass order by conname`,
  );
  assert.deepEqual(
    rows.map((c) => c.conname),
    [
      "battle_participant_battle_id_fkey",
      "battle_pkey",
      "player_event_battle_id_fkey",
    ],
  );
  // A fresh build is what the estimate sizes.
  const report = await reindex(SCRATCH_URL, { table: "battle" });
  const pkey = report.indexes.find((i) => i.name === "battle_pkey");
  const { estimated_fresh_bytes: estimated } = pkey.bloat_estimate;
  assert.ok(
    Math.abs(estimated - pkey.bytes) <= pkey.bytes * 0.2,
    `estimate ${estimated} against a fresh ${pkey.bytes}`,
  );
});

test("a cancelled rebuild leaves an invalid _ccnew, which blocks rebuilds until drop_invalid takes it", async () => {
  const before = await sizeOf("battle_cursor_key");
  // An open writer: the rebuild's second phase waits for it, and a short
  // lock timeout cancels the wait after the copy exists.
  await db.query("begin");
  await db.query(
    `update battle set type = type where cursor = (select min(cursor) from battle)`,
  );
  let failed;
  try {
    failed = await reindex(
      SCRATCH_URL,
      { table: "battle", index: "battle_cursor_key", apply: true },
      { statementMs: 30_000, lockMs: 300 },
    );
  } finally {
    await db.query("rollback");
  }
  assert.equal(failed.error, "reindex_failed", JSON.stringify(failed));
  assert.equal(failed.code, "55P03");
  assert.deepEqual(
    failed.invalid_indexes.map((i) => [i.name, i.leftover]),
    [["battle_cursor_key_ccnew", "ccnew"]],
  );
  assert.equal(await sizeOf("battle_cursor_key"), before);

  const report = await reindex(SCRATCH_URL, { table: "battle" });
  assert.deepEqual(
    report.invalid_indexes.map((i) => i.name),
    ["battle_cursor_key_ccnew"],
  );
  const leftover = report.indexes.find(
    (i) => i.name === "battle_cursor_key_ccnew",
  );
  assert.equal(leftover.valid, false);
  assert.equal(leftover.leftover, "ccnew");

  // Every rebuild is refused while it stands.
  const blocked = await reindex(SCRATCH_URL, {
    table: "battle",
    index: "battle_time_idx",
    apply: true,
  });
  assert.equal(blocked.error, "invalid_index_present");
  assert.deepEqual(
    blocked.invalid_indexes.map((i) => i.name),
    ["battle_cursor_key_ccnew"],
  );
  // drop_invalid takes only an invalid index.
  const valid = await reindex(SCRATCH_URL, {
    table: "battle",
    drop_invalid: "battle_cursor_key",
  });
  assert.equal(valid.error, "index_valid");
  assert.equal(
    (
      await reindex(SCRATCH_URL, {
        table: "battle",
        drop_invalid: "no_such_index",
      })
    ).error,
    "unknown_index",
  );

  const dropped = await reindex(SCRATCH_URL, {
    table: "battle",
    drop_invalid: "battle_cursor_key_ccnew",
  });
  assert.equal(dropped.error, undefined, JSON.stringify(dropped));
  assert.equal(dropped.dropped, "battle_cursor_key_ccnew");
  assert.deepEqual(dropped.invalid_indexes, []);

  const rebuilt = await reindex(SCRATCH_URL, {
    table: "battle",
    index: "battle_cursor_key",
    apply: true,
  });
  assert.equal(rebuilt.error, undefined, JSON.stringify(rebuilt));
  assert.equal(rebuilt.after.valid, true);
  assert.ok(rebuilt.after.bytes < before);
});

test("the estimate sizes a btree from its columns' widths", () => {
  const bigint = { attname: "k", typlen: 8, typalign: "d", null_frac: 0 };
  // 1,000 rows of 16-byte tuples and 4-byte line pointers: 366 to a 90%
  // leaf, so 3 leaves, a root and the metapage.
  assert.deepEqual(
    estimateBtreeBytes({
      rows: 1000,
      columns: [{ ...bigint, avg_width: 8 }],
      fillfactor: 90,
      blockSize: 8192,
    }),
    { bytes: 5 * 8192 },
  );
  const at = (columns, rows = 10) =>
    estimateBtreeBytes({ rows, columns, fillfactor: 90, blockSize: 8192 });
  assert.deepEqual(at([{ ...bigint, avg_width: null }]), {
    bytes: null,
    reason: "no_statistics",
  });
  assert.deepEqual(at([{ attname: null }]), {
    bytes: null,
    reason: "expression_column",
  });
  assert.deepEqual(at([{ ...bigint, avg_width: 8 }], -1), {
    bytes: null,
    reason: "never_analyzed",
  });
});
