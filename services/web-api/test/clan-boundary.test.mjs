import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const CODE = /\.(m?js|jsx|ts|tsx)$/;
const SKIP = new Set([
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
]);

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(p);
    else if (CODE.test(entry.name)) yield p;
  }
}

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

async function imports(file) {
  const text = await readFile(file, "utf8");
  return [...text.matchAll(SPECIFIER)].map((m) => m[1]);
}

const packageOf = (spec) =>
  spec.startsWith("@")
    ? spec.split("/").slice(0, 2).join("/")
    : spec.split("/")[0];

test("MCP and public tool code cannot import private Clan state", async () => {
  const bad = [];
  for (const top of ["services/mcp/src", "packages/tools/src"]) {
    for await (const file of files(path.join(ROOT, top))) {
      const text = await readFile(file, "utf8");
      if (/\bclan_state\b/.test(text)) bad.push(path.relative(ROOT, file));
      for (const spec of await imports(file)) {
        if (
          spec === "@elixir-mcp/auth/clan-context" &&
          path.relative(ROOT, file) !==
            "packages/tools/src/tools/clan-context.mjs"
        )
          bad.push(
            `${path.relative(ROOT, file)}: unapproved minimal reader import`,
          );
        if (
          ["@elixir-mcp/clan", "@elixir-mcp/clan-state"].includes(
            packageOf(spec),
          )
        )
          bad.push(`${path.relative(ROOT, file)}: ${spec}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
