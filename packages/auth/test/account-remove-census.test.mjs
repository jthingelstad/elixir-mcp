/**
 * The removal's census (2026-11-23): every table that names an account
 * is either one the removal deletes from (REMOVED_TABLES) or one it
 * keeps on purpose (KEPT_TABLES, each with its reason), and every column
 * of `account` is either cleared by the tombstone or kept as nothing
 * personal. Read from the migrated schema, so a migration that adds a
 * personal table or an account column fails here until
 * account-remove.mjs says what happens to it. The step list was last
 * censused by hand at 0285; this replaces the hand census.
 *
 * "Names an account": a foreign key to account(account_id), or a uuid
 * column whose name ends in `account_id` or `account` (a key that never
 * got a foreign key, such as a read receipt's). Text keys holding an
 * account id (rate_limit buckets, clan_state's `account#<id>`) cannot be
 * read off the schema; the removal names them in its steps.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  REMOVED_TABLES,
  KEPT_TABLES,
  ACCOUNT_COLUMNS_CLEARED,
  ACCOUNT_COLUMNS_KEPT,
} from "../src/account-remove.mjs";
import { createScratch, dropScratch } from "../../ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_remove_census_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
});
after(async () => {
  await db?.end();
  await dropScratch(NAME);
});

test("every table that names an account is removed or kept on purpose", async () => {
  const { rows: fks } = await db.query(
    `select distinct c.conrelid::regclass::text as tbl
       from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'account'::regclass`,
  );
  const { rows: named } = await db.query(
    `select distinct table_name as tbl from information_schema.columns
      where table_schema = 'public' and data_type = 'uuid'
        and (column_name like '%account_id' or column_name like '%account')`,
  );
  const naming = new Set([...fks, ...named].map((r) => r.tbl));
  const removed = new Set(REMOVED_TABLES);
  const unaccounted = [...naming]
    .filter((t) => !removed.has(t) && !(t in KEPT_TABLES))
    .sort();
  assert.deepEqual(
    unaccounted,
    [],
    "a table names an account: add it to the removal's steps, or to KEPT_TABLES with why (packages/auth/src/account-remove.mjs)",
  );
  // Nothing is listed twice, and nothing listed is gone from the schema.
  for (const t of Object.keys(KEPT_TABLES))
    assert.ok(!removed.has(t), `${t} is both removed and kept`);
  const { rows: tables } = await db.query(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const exists = new Set(tables.map((r) => r.table_name));
  for (const t of [...removed, ...Object.keys(KEPT_TABLES)])
    assert.ok(exists.has(t), `${t} is listed but no longer exists`);
});

test("every account column is cleared by the tombstone or kept as nothing personal", async () => {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'account'`,
  );
  const columns = rows.map((r) => r.column_name);
  const listed = new Set([...ACCOUNT_COLUMNS_CLEARED, ...ACCOUNT_COLUMNS_KEPT]);
  assert.deepEqual(
    columns.filter((c) => !listed.has(c)).sort(),
    [],
    "a new account column: clear it in the tombstone or list it as kept (account-remove.mjs)",
  );
  assert.deepEqual(
    [...listed].filter((c) => !columns.includes(c)).sort(),
    [],
    "a listed account column no longer exists",
  );
});
