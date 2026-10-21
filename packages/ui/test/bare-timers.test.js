import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The source half of flash.test.tsx, in plain JavaScript because the
 *  kit's typecheck has no Node types. Every React source a test can
 *  mount. */
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const roots = ["apps/web/src", "packages/clan-web/src", "packages/ui/src"];
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory()
      ? walk(p)
      : /\.[jt]sx?$/.test(name)
        ? [p]
        : [];
  });
}

test("no view sets state from a bare timer; a passing flag is useFlash", () => {
  const bare = /setTimeout\(\s*\(\)\s*=>\s*set[A-Z]\w*\(/;
  const offenders = roots
    .flatMap((root) => walk(path.join(repo, root)))
    .map((file) => path.relative(repo, file))
    // The hook itself is the one timer that may, and it clears on unmount.
    .filter((file) => file !== "packages/ui/src/flash.ts")
    .filter((file) => bare.test(readFileSync(path.join(repo, file), "utf8")));
  expect(offenders).toEqual([]);
});
