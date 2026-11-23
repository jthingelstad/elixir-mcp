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
// seam (12.0.0): the clan directory, the policy's public part, and a
// person's own view of their clan (#535).
test("the approved reader serves exactly two tools", async () => {
  const { clanContextTools } =
    await import("../../../packages/tools/src/tools/clan-context.mjs");
  assert.deepEqual(Object.keys(clanContextTools).sort(), [
    "clans_directory",
    "clans_my_view",
  ]);
});

// The clan directory (#768) reads through the same seam: Clan's web wiring
// and, since 12.0.0, the clans_directory tool. Nothing else calls it.
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

// The player map and Near you (#768) read people's places through the same
// seam, for Find alone: never MCP, a tool, or Clan's own handler.
test("only Find's people reads read the player map and Near you", async () => {
  const callers = [];
  for (const top of ["services", "packages", "apps"]) {
    for await (const file of files(path.join(ROOT, top))) {
      const rel = path.relative(ROOT, file);
      if (/(^|\/)(test|e2e)\//.test(rel)) continue;
      const text = await readFile(file, "utf8");
      if (/\b(readPlayerMap|readNearYou)\b/.test(text)) callers.push(rel);
    }
  }
  assert.deepEqual(callers.sort(), [
    "packages/auth/src/clan-context.mjs",
    "services/web-api/src/people.mjs",
  ]);
});

// A place belongs to the claim that wrote it (2026-11-14): every read of
// people's places goes through the one rule in the seam. Clan's web
// wiring (your place, the picker, the clan map) and the passport read
// them by tag with readOwnedPlaces, as the account page (0277) does; the player map and Near you apply the
// same predicate in their own statements. No other code reads place rows.
test("people's places are read only under the ownership rule", async () => {
  const callers = [];
  const raw = [];
  for (const top of ["services", "packages", "apps"]) {
    for await (const file of files(path.join(ROOT, top))) {
      const rel = path.relative(ROOT, file);
      if (/(^|\/)(test|e2e)\//.test(rel)) continue;
      const text = await readFile(file, "utf8");
      if (/\breadOwnedPlaces\b(?!`)/.test(text)) callers.push(rel);
      // A read of place rows: by key in SQL, or through a ledger read.
      if (
        rel !== "packages/auth/src/clan-context.mjs" &&
        (/'place#'\s*\|\|/.test(text) || /\.places\s*\(/.test(text))
      )
        raw.push(rel);
    }
  }
  assert.deepEqual(callers.sort(), [
    "packages/auth/src/clan-context.mjs",
    "packages/stamps/src/legacy.mjs",
    "services/web-api/src/account-page.mjs",
    "services/web-api/src/clan.mjs",
    "services/web-api/src/routes/passport.mjs",
  ]);
  assert.deepEqual(raw, []);
});
