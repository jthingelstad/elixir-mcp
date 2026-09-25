/**
 * The ops catalogue (.claude/skills/ops/ops.md) lists every payload key
 * the migrate Lambda dispatches, one table row each, with the op's name
 * in braces as the row's first cell: | `{stats}` | ... |. The dispatcher
 * grew to fifty-odd ops while the runbooks named about a dozen, so the
 * rest were findable only by reading lambda.mjs. A catalogue nothing
 * checks drifts the way docs/DESIGN.md did; this keeps the two equal. A
 * new op without a row fails, and so does a row for an op that is gone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const LAMBDA = "services/migrate/src/lambda.mjs";
const CATALOGUE = ".claude/skills/ops/ops.md";

// Every `if (event?.<key>)` in the handler is one op.
const dispatched = [
  ...readFileSync(path.join(repoRoot, LAMBDA), "utf8").matchAll(
    /\bif\s*\(\s*event\?\.([a-z_]+)\s*\)/g,
  ),
].map((m) => m[1]);

// Every table row whose first cell is `{name}` is one catalogued op.
const catalogued = [
  ...readFileSync(path.join(repoRoot, CATALOGUE), "utf8").matchAll(
    /^\|\s*`\{([a-z_]+)\}`\s*\|/gm,
  ),
].map((m) => m[1]);

test("the dispatcher's ops are found", () => {
  assert.ok(
    dispatched.includes("stats") && dispatched.includes("vacuum"),
    `no ops parsed from ${LAMBDA}: the dispatch shape changed, so change this test's pattern with it`,
  );
});

test("every dispatched op has a row in the catalogue", () => {
  const rows = new Set(catalogued);
  const missing = [...new Set(dispatched)].filter((op) => !rows.has(op));
  assert.deepEqual(
    missing.sort(),
    [],
    `dispatched by ${LAMBDA} but missing from ${CATALOGUE}: ${missing.join(", ")} (add a row whose first cell is \`{name}\`)`,
  );
});

test("every catalogue row is an op the dispatcher has", () => {
  const ops = new Set(dispatched);
  const stale = [...new Set(catalogued)].filter((op) => !ops.has(op));
  assert.deepEqual(
    stale.sort(),
    [],
    `in ${CATALOGUE} but not dispatched by ${LAMBDA}: ${stale.join(", ")} (remove the row, or fix its name)`,
  );
});

test("each op has one row", () => {
  const twice = catalogued.filter((op, i) => catalogued.indexOf(op) !== i);
  assert.deepEqual(
    twice,
    [],
    `catalogued more than once in ${CATALOGUE}: ${twice.join(", ")}`,
  );
});
