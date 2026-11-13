/**
 * 0257 dropped what the social-layer pivot left with no purpose: the
 * Settings year graph's player_activity table, an integration's usage and
 * profile-refresh counts, and integration's scopes and limits. No source
 * names them again, not even in a comment, so a reader or writer cannot
 * creep back. Migrations keep their history and the docs and change notes
 * tell it. Built at the 2026-11-13 contract step.
 *
 * player_activity is also a timeline entry kind (a string, not a table),
 * so for that one name only SQL that touches a table counts.
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
// This guard, and its sibling that reads the migrated catalog to prove
// the objects are gone, name them on purpose.
const SELF = new Set([
  "services/migrate/test/pivot-leftovers-gone.test.mjs",
  "services/migrate/test/pivot-leftovers-schema.test.mjs",
]);
const NAMES =
  /\b(integration_usage|integration_profile_refresh|refresh_limit|hourly_limit|daily_limit)\b|\b(from|into|join|update|table|truncate|exists)\s+player_activity\b/i;
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
    } else if (CODE.test(entry.name) && !SELF.has(rel)) yield rel;
  }
}

test("no source names what 0257 dropped", () => {
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
  assert.ok(NAMES.test("select * from player_activity where"));
  assert.ok(NAMES.test("insert into integration_usage (account_id)"));
  assert.ok(NAMES.test("select refresh_limit from integration"));
  assert.ok(NAMES.test("daily_limit: 10000"));
  // The timeline kind and Clan's model cap are other things.
  assert.ok(!NAMES.test('kind: "player_activity",'));
  assert.ok(!NAMES.test('{"error":"model_daily_limit"}'));
  const seen = [...walk("")];
  for (const f of [
    "services/migrate/src/ops-accounts.mjs",
    "packages/auth/src/oauth.mjs",
    "services/jobs/src/index.mjs",
  ])
    assert.ok(seen.includes(f), f);
  assert.ok(!seen.some((f) => f.startsWith("db/migrations/")));
});
