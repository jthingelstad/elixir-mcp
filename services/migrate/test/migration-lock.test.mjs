/**
 * Shipped migrations are immutable, and until 2026-09-25 only production
 * said so: the runner compares each applied file's sha256 with the
 * schema_migrations row and refuses a mismatch ("history is immutable"),
 * which fails the deploy halfway, after the build and upload. An edited
 * comment is enough. db/migrations.sha256 pins every file's sha256 (the
 * runner's own, over the whole file), so the edit fails `npm run verify`
 * instead.
 *
 * A new migration adds its line in the commit that adds the file; the
 * failure message prints the line. A migration that has not shipped yet
 * may still change, and its line with it. A line for a file that already
 * shipped never changes: write the next migration instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrations } from "../src/migrate.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const LOCK = path.join(root, "db/migrations.sha256");

function readLock() {
  const pinned = new Map();
  for (const line of readFileSync(LOCK, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64}) {2}(\S+\.sql)$/.exec(line);
    assert.ok(m, `db/migrations.sha256: not "<sha256>  <file>": ${line}`);
    pinned.set(m[2], m[1]);
  }
  return pinned;
}

test("every migration matches its pinned sha256, and every file is pinned", async () => {
  const pinned = readLock();
  const files = await loadMigrations(path.join(root, "db/migrations"));
  const changed = [];
  const unpinned = [];
  for (const m of files) {
    const sha = pinned.get(m.name);
    if (sha === undefined) unpinned.push(`${m.sha256}  ${m.name}`);
    else if (sha !== m.sha256) changed.push(m.name);
  }
  assert.deepEqual(
    changed,
    [],
    `changed since pinned: ${changed.join(", ")}. A shipped migration is immutable (production refuses it mid-deploy): revert it and write the next migration. If it has not shipped yet, update its line in db/migrations.sha256.`,
  );
  assert.deepEqual(
    unpinned,
    [],
    `add to db/migrations.sha256:\n${unpinned.join("\n")}`,
  );
  const onDisk = new Set(files.map((m) => m.name));
  const gone = [...pinned.keys()].filter((name) => !onDisk.has(name));
  assert.deepEqual(
    gone,
    [],
    `pinned but missing: ${gone.join(", ")}. A shipped migration is never removed.`,
  );
});
