#!/usr/bin/env node
/**
 * The real-tag guard, by hand (`lib/no-real-tags.mjs` says what counts).
 *
 *   node infra/scripts/no-real-tags.mjs   check, as the test does
 *
 * A file holding a tag that is not King Thing's, POAP KINGS' or listed in
 * `docs/invented-tags.json` fails, as does a pinned migration off its
 * count. The fix is to take the real tag out (invent one instead). It
 * prints paths and numbers, never a tag. Needs `npm run build` first (it
 * reads `normalizeTag` from contracts' dist).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { census, check } from "./lib/no-real-tags.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

if (process.argv.length > 2) {
  console.error("no-real-tags: takes no arguments");
  process.exit(2);
}

const { found, pinned } = check(census(root));
for (const f of found)
  console.error(`found: ${f.file} has ${f.have} non-allowed tags`);
for (const p of pinned)
  console.error(`pinned: ${p.file} has ${p.have} (fixed at ${p.want})`);
if (found.length > 0 || pinned.length > 0) {
  console.error(
    "no-real-tags: take the real tag out; invent one starting #0 and list it in docs/invented-tags.json",
  );
  process.exit(1);
}
console.log("no-real-tags: no file holds a real-looking tag");
