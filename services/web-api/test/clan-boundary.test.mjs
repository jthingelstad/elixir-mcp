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

// The import rules above pin the importer, not the surface: a third tool in
// the approved file would pass them silently. Two tools read through the
// seam (12.0.0): the clan directory, the policy's public part, for a person
// and their agents; and a person's own view of their clan (#535).
// clans_context, an agent's private policy context, retired in 12.0.0.
test("the approved reader serves exactly two tools, each to its own principals", async () => {
  const { clanContextTools } =
    await import("../../../packages/tools/src/tools/clan-context.mjs");
  const { PERSON_ONLY_TOOLS, AGENT_ONLY_TOOLS, NOT_FOR_PERSONS } =
    await import("@elixir-mcp/contracts");
  assert.deepEqual(Object.keys(clanContextTools).sort(), [
    "clans_directory",
    "clans_my_view",
  ]);
  assert.ok(PERSON_ONLY_TOOLS.includes("clans_my_view"));
  // A person and their agents; never an integration.
  assert.ok(AGENT_ONLY_TOOLS.includes("clans_directory"));
  assert.ok(!PERSON_ONLY_TOOLS.includes("clans_directory"));
  assert.ok(!NOT_FOR_PERSONS.includes("clans_directory"));
});

// The clan directory (#768) reads through the same seam: Clan's web wiring
// and, since 12.0.0, the clans_directory tool (which /api/v1's
// GET /clans/directory mirrors). Nothing else calls it.
test("only Clan's web wiring and the clans_directory tool read the clan directory", async () => {
  const callers = [];
  for (const top of ["services", "packages", "apps"]) {
    for await (const file of files(path.join(ROOT, top))) {
      const rel = path.relative(ROOT, file);
      if (/(^|\/)(test|e2e)\//.test(rel)) continue;
      const text = await readFile(file, "utf8");
      if (/\breadClanDirectory\b/.test(text)) callers.push(rel);
    }
  }
  assert.deepEqual(callers.sort(), [
    "packages/auth/src/clan-context.mjs",
    "packages/tools/src/tools/clan-context.mjs",
    "services/web-api/src/clan.mjs",
  ]);
});
