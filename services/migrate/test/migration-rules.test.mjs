/**
 * The migration rules (docs/DECISIONS.md "Schema and migrations";
 * docs/ENGINEERING.md), checked on every migration from 0176 on. The
 * rules held only by review until 2026-09-25, when an audit found 0152
 * validating in the file that added the constraint and 0169 re-keying a
 * table in one transaction. Those stay as they are (migrations are
 * checksum-immutable); this keeps the next one honest.
 *
 * - Lock shapes take three migrations: NOT VALID, then VALIDATE, then
 *   SET NOT NULL, each in its own file.
 * - Migrations never rewrite a large table: no in-place column type
 *   change, no primary-key re-key, no stored generated column added to
 *   an existing table.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../db/migrations");
const FIRST_CHECKED = 176;

const checked = readdirSync(dir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .filter((f) => Number(f.slice(0, 4)) >= FIRST_CHECKED)
  .map((f) => ({
    file: f,
    // Comments say what a migration is about; only statements count.
    sql: readFileSync(path.join(dir, f), "utf8")
      .replace(/--[^\n]*/g, "")
      .toLowerCase(),
  }));

test("lock shapes take three migrations: NOT VALID, VALIDATE and SET NOT NULL never share a file", () => {
  for (const { file, sql } of checked) {
    const notValid = /\bnot valid\b/.test(sql);
    const validate = /\bvalidate constraint\b/.test(sql);
    const notNull = /\bset not null\b/.test(sql);
    assert.ok(
      [notValid, validate, notNull].filter(Boolean).length <= 1,
      `${file} mixes NOT VALID / VALIDATE / SET NOT NULL`,
    );
  }
});

test("no migration rewrites a table in place", () => {
  for (const { file, sql } of checked) {
    assert.doesNotMatch(
      sql,
      /alter\s+column\s+\w+\s+(set\s+data\s+)?type\b/,
      `${file} changes a column type in place (add a column, fill it with a keyset-batched op)`,
    );
    assert.ok(
      !(/drop constraint \w*_pkey/.test(sql) && /add primary key/.test(sql)),
      `${file} re-keys a table in place`,
    );
    assert.doesNotMatch(
      sql,
      /alter\s+table[\s\S]*?add\s+column[\s\S]*?generated\s+always\s+as[\s\S]*?stored/,
      `${file} adds a stored generated column to an existing table (a rewrite)`,
    );
  }
});

// A statement that locks a table live traffic uses fails fast rather than
// queueing behind a long read with ingest queued behind it: 0156, 0158,
// 0169, 0170 and 0176 open with `set local lock_timeout`, 0172-0175 did
// not (the 2026-09-25 skill review). A table the same file creates has no
// traffic yet and needs none.
function touchedTables(sql) {
  const created = new Set(
    [
      ...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/g),
    ].map((m) => m[1]),
  );
  const touched = [
    ...sql.matchAll(
      /\b(?:alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?|delete\s+from\s+|update\s+|create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(?:\w+\s+)?on\s+(?:only\s+)?)([a-z_][\w.]*)/g,
    ),
  ].map((m) => m[1]);
  return [...new Set(touched)].filter((t) => !created.has(t));
}

test("a migration that locks an existing table sets lock_timeout first", () => {
  for (const { file, sql } of checked) {
    const tables = touchedTables(sql);
    if (tables.length === 0) continue;
    assert.match(
      sql,
      /set\s+local\s+lock_timeout\s*=/,
      `${file} alters, updates, deletes from or indexes ${tables.join(", ")} without \`set local lock_timeout = '5s';\` at the top`,
    );
  }
});

test("the lock_timeout rule sees the statements it is meant to", () => {
  assert.deepEqual(touchedTables("alter table battle add column x int;"), [
    "battle",
  ]);
  assert.deepEqual(
    touchedTables("create index idx_a on war_week (season_id);"),
    ["war_week"],
  );
  assert.deepEqual(
    touchedTables("delete from war_attendance_day where true;"),
    ["war_attendance_day"],
  );
  assert.deepEqual(
    touchedTables(
      "create table t (id int); alter table t add column y int; create index i on t (y);",
    ),
    [],
  );
});
