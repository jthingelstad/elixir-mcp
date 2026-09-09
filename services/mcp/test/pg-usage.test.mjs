import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".mjs")) out.push(full);
  }
  return out;
}

/**
 * A pg.Client is ONE connection and pg serializes what you send it, so
 * Promise.all over queries wins nothing and emits a DeprecationWarning
 * that becomes an error in pg 9 (docs/ENGINEERING.md). Measured
 * 2026-09-09: 913 ms concurrent-looking vs 907 ms sequential for three
 * pg_sleep(0.3) calls on one client.
 *
 * The guard reads source rather than trusting memory, because this crept
 * back in three separate features before anyone noticed the warnings.
 */
test("no Promise.all wraps database queries in service source", () => {
  const offenders = [];
  for (const dir of ["services", "packages"]) {
    for (const file of sourceFiles(path.join(repoRoot, dir))) {
      if (file.includes("/test/")) continue;
      const src = readFileSync(file, "utf8");
      let from = 0;
      for (;;) {
        const at = src.indexOf("Promise.all", from);
        if (at === -1) break;
        from = at + 1;
        // Comments about the rule are not the rule being broken.
        const lineStart = src.lastIndexOf("\n", at) + 1;
        if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, at))) continue;
        // The argument list: balanced from the first paren after the call.
        let depth = 0;
        let end = at;
        for (let i = src.indexOf("(", at); i < src.length; i += 1) {
          if (src[i] === "(") depth += 1;
          else if (src[i] === ")") {
            depth -= 1;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        const block = src.slice(at, end + 1);
        if (/\bdb\.query\(/.test(block) || /\bdb,\s/.test(block)) {
          offenders.push(
            `${path.relative(repoRoot, file)}:${src.slice(0, at).split("\n").length}`,
          );
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Promise.all over queries on one pg client: ${offenders.join(", ")}. Await them one at a time (docs/ENGINEERING.md).`,
  );
});
