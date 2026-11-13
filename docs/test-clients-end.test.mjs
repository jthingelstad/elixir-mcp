/**
 * A test's own Postgres client ends in a `finally`. The old shape,
 *
 *     const db = new pg.Client(...);
 *     await db.connect();
 *     ...queries and assertions...
 *     await db.end();
 *
 * leaks the connection whenever a line in between throws: the failing test
 * keeps its process alive and holds one of the host's client slots while
 * the rest of the suite runs. Removed on 2026-11-13 from every test that
 * had it; this guard fails on its return, with the file and line.
 *
 * Only clients a test creates with `new pg.Client` are read. A pool lease
 * (`database.lease()`) ends mid-test on purpose: that release is what
 * `packages/http/test/database.test.mjs` tests.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every tracked test source. */
function testFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(
      (file) =>
        /\.(mjs|js|jsx|ts)$/.test(file) &&
        /(^|\/)(test|e2e|acceptance)\/|\.test\./.test(file),
    );
}

/** Each `connect()` of a client created in `text` whose `end()` follows at
 *  the same depth, after other work: an end no `finally` reaches. */
export function unguardedEnds(text) {
  const clients = new Set(
    [...text.matchAll(/\b(\w+) = new (?:pg\.)?Client\(/g)].map((m) => m[1]),
  );
  const lines = text.split("\n");
  const found = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)await (\w+)\.connect\(\);$/.exec(line);
    if (!m || !clients.has(m[2])) return;
    const [, indent, name] = m;
    let between = 0;
    for (const next of lines.slice(i + 1)) {
      if (!next.trim()) continue;
      if (next.length - next.trimStart().length < indent.length) break;
      if (next === `${indent}await ${name}.end();`) {
        if (between) found.push(i + 1);
        break;
      }
      between++;
    }
  });
  return found;
}

test("every test's own Postgres client ends in a finally", () => {
  const files = testFiles();
  assert.ok(files.length > 100, "the test sources are read");
  const found = [];
  for (const file of files)
    for (const line of unguardedEnds(
      readFileSync(path.join(root, file), "utf8"),
    ))
      found.push(`${file}:${line}`);
  assert.deepEqual(found, []);
});

test("the guard sees the old shape and passes the new one", () => {
  const old = [
    "test('x', async () => {",
    "  const db = new pg.Client({ connectionString: URL });",
    "  await db.connect();",
    "  await db.query('select 1');",
    "  await db.end();",
    "});",
  ].join("\n");
  assert.deepEqual(unguardedEnds(old), [3]);
  const guarded = [
    "test('x', async () => {",
    "  const db = new pg.Client({ connectionString: URL });",
    "  await db.connect();",
    "  try {",
    "    await db.query('select 1');",
    "  } finally {",
    "    await db.end();",
    "  }",
    "});",
  ].join("\n");
  assert.deepEqual(unguardedEnds(guarded), []);
  // A client handed back to its caller is the caller's to end.
  const handed = [
    "async function conn() {",
    "  const c = new pg.Client({ connectionString: URL });",
    "  await c.connect();",
    "  return c;",
    "}",
  ].join("\n");
  assert.deepEqual(unguardedEnds(handed), []);
});
