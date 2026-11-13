/**
 * 0256 dropped 0091's per-card tables: a participant's, a duel round's and
 * a deck's cards are arrays on the rows that own them (0255). No source
 * names the old tables again, not even in a comment, so a reader or
 * writer cannot creep back. Migrations keep their history and the docs
 * and change notes tell it; the contract changelog quotes what 3.4.0
 * said at the time. Built at the 2026-11-13 contract step.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".astro",
  ".worktrees",
  "coverage",
]);
const SKIP_PATHS = [
  "db/migrations/",
  "docs/",
  ".claude/",
  "packages/contracts/src/changes/",
];
const SELF = "services/migrate/test/card-tables-gone.test.mjs";
const NAMES = /\b(battle_participant_card|deck_card)\b/;
const CODE = /\.(mjs|cjs|js|jsx|ts|tsx|sql|yaml|yml|json|sh)$/;

function* walk(dir) {
  for (const entry of readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_PATHS.some((p) => `${rel}/`.startsWith(p))) continue;
      yield* walk(rel);
    } else if (CODE.test(entry.name) && rel !== SELF) yield rel;
  }
}

test("no source names the card tables 0256 dropped", () => {
  const hits = [];
  for (const file of walk(""))
    readFileSync(path.join(ROOT, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (NAMES.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  assert.deepEqual(hits, []);
});

test("the guard sees what it guards", () => {
  assert.ok(NAMES.test("select * from deck_card"));
  assert.ok(NAMES.test("insert into battle_participant_card"));
  assert.ok(!NAMES.test("battle_participant_round deck_cards card_ids"));
  const seen = [...walk("")];
  for (const f of [
    "packages/ingest/src/deck-cards.mjs",
    "packages/tools/src/tools/war/common.mjs",
    "services/migrate/src/lambda.mjs",
  ])
    assert.ok(seen.includes(f), f);
  assert.ok(!seen.some((f) => f.startsWith("db/migrations/")));
});
