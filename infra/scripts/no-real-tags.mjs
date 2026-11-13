#!/usr/bin/env node
/**
 * The real-tag ratchet, by hand (`lib/no-real-tags.mjs` says what counts).
 *
 *   node infra/scripts/no-real-tags.mjs           check, as the test does
 *   node infra/scripts/no-real-tags.mjs --update  lower the baseline to today
 *
 * `--update` only ever lowers: a file whose count rose, or a new file, is
 * refused, and the fix is to take the real tag out (invent one instead), never
 * to raise the baseline. It prints paths and numbers, never a tag.
 * Needs `npm run build` first (it reads `normalizeTag` from contracts' dist).
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { census, compare, lowered } from "./lib/no-real-tags.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const baselinePath = path.join(root, "docs/no-real-tags.baseline.json");

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== "--update");
if (unknown.length > 0) {
  console.error(
    `no-real-tags: unknown argument ${unknown.join(" ")}; only --update`,
  );
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).files;
const counts = census(root);
const { rose, fell, pinned } = compare(counts, baseline);
const summary = { files: baseline };

for (const r of rose)
  console.error(
    `rose: ${r.file} has ${r.have} non-allowed tags (baseline ${r.was})`,
  );
for (const p of pinned)
  console.error(`pinned: ${p.file} has ${p.have} (fixed at ${p.want})`);
if (rose.length > 0 || pinned.length > 0) {
  console.error(
    "no-real-tags: take the real tag out; invent one starting #0 and list it in docs/invented-tags.json",
  );
  process.exit(1);
}

if (args.includes("--update")) {
  const next = lowered(counts, baseline);
  const text = `${JSON.stringify({ files: next }, null, 2)}\n`;
  writeFileSync(baselinePath, text);
  console.log(`no-real-tags: lowered ${fell.length} files`);
  Object.assign(summary, { files: next });
} else if (fell.length > 0) {
  console.log(
    `no-real-tags: ${fell.length} files fell below the baseline; run with --update to lower it`,
  );
}
const total = Object.values(summary.files).reduce((a, b) => a + b, 0);
console.log(
  `no-real-tags: ${Object.keys(summary.files).length} files, ${total} in the baseline`,
);
