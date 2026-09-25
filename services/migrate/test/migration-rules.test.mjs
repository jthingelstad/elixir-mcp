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
