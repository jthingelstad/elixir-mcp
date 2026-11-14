import { test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The surface once called Ladder is Stats (to a reader since 2026-11-12,
 * in code since 2026-11-14), and its old name does not creep back into
 * the code. "ladder" still means the Trophy Road game mode (a mode value,
 * `mode_group === "ladder"`, a `ladder:` row in a by-mode count), and the
 * stored or public names keep it: the docs slugs (`/docs/ladder*`) and the
 * feedback area value `ladder`. So this looks only at the shapes a
 * surface name takes and a mode value never does: file and folder names,
 * camelCase and constant identifiers, `ladder-` class names, the query
 * key, the help drawer's doc keys and the shell manifest's product key.
 */
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(web, "../..");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sources = ["src", "test", "e2e"].flatMap((d) =>
  walk(path.join(web, d)).filter((f) => /\.[jt]sx?$/.test(f)),
);

test("no file or folder of the web app is named for Ladder", () => {
  expect(existsSync(path.join(web, "src/ladder"))).toBe(false);
  const named = sources
    .map((f) => path.relative(web, f))
    .filter((f) => /ladder/i.test(f));
  expect(named).toEqual([]);
});

test("no identifier, class, query key or doc key names the surface Ladder", () => {
  const shapes = [
    // LADDER, LADDER_PAGES; isLadder, ladderHref; LadderPage, LadderFrame.
    /\bLADDER\w*/,
    /\b(?:is|use)Ladder\b/,
    /\bladder[A-Z]\w*/,
    /\bLadder[A-Z]\w*/,
    // A class or id, but not a docs slug (/docs/ladder-cards).
    /(?<![\w/-])ladder-[a-z]/,
    /\["me",\s*"ladder"/,
    /["'`]ladder:/,
    /\bproduct(?::|\s*[!=]==)\s*"ladder"/,
    /\bsection:\s*"ladder"/,
  ];
  const hits = [];
  for (const f of sources) {
    if (f.endsWith("stats-name.test.js")) continue;
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (shapes.some((rx) => rx.test(line)))
          hits.push(`${path.relative(web, f)}:${i + 1}: ${line.trim()}`);
      });
  }
  expect(hits).toEqual([]);
});

test("the stylesheet has no ladder- class and the manifest no ladder product", () => {
  const css = readFileSync(
    path.join(repo, "packages/design/src/components.css"),
    "utf8",
  );
  expect(css.match(/\.ladder-[a-z][\w-]*/g) ?? []).toEqual([]);
  const shell = JSON.parse(
    readFileSync(path.join(repo, "packages/ui/src/shell.json"), "utf8"),
  );
  expect(shell.products.map((p) => p.key)).not.toContain("ladder");
  expect(shell.products.find((p) => p.key === "stats")?.label).toBe("Stats");
});
