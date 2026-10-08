/**
 * Attested facts are the one viewer-dependent read in a universal-reads
 * system: who sees a fact is decided per reader
 * in one place. So only two runtime modules may name the table: the read
 * (`packages/tools/src/activity/entries.mjs`, factItems) and the write
 * (`packages/record/src/attested-facts.mjs`). A third reader would carry
 * the facts past the visibility rule, into a mail, a cache or a report.
 * Migrations, tests and docs may name it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ALLOWED = new Set([
  "packages/tools/src/activity/entries.mjs",
  "packages/record/src/attested-facts.mjs",
]);

function runtimeSources() {
  const roots = [];
  for (const group of ["services", "packages", "apps"])
    for (const name of readdirSync(path.join(repoRoot, group))) {
      const src = path.join(repoRoot, group, name, "src");
      if (existsSync(src)) roots.push(src);
    }
  for (const extra of ["infra/scripts"]) roots.push(path.join(repoRoot, extra));
  return roots.flatMap((root) =>
    readdirSync(root, { recursive: true })
      .filter(
        (f) =>
          /\.(mjs|js|ts|tsx|jsx)$/.test(f) &&
          !/(^|\/)(node_modules|dist|test)\//.test(f) &&
          !/\.test\.mjs$/.test(f),
      )
      .map((f) => path.relative(repoRoot, path.join(root, f))),
  );
}

test("only the read and the write name attested_fact", () => {
  const files = runtimeSources();
  assert.ok(files.length > 100, `scanned ${files.length} files`);
  const naming = files.filter((f) =>
    /\battested_fact\b/.test(readFileSync(path.join(repoRoot, f), "utf8")),
  );
  assert.deepEqual(naming.sort(), [...ALLOWED].sort());
});
