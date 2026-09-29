/**
 * Clan lives in elixir-mcp's repository (clan/, 2026-09-28) but not in its
 * runtime: it reads Elixir over HTTP (/api/v1) like any integration, and
 * shares only the kit (@elixir-mcp/ui, client, design). An import from
 * Elixir's services or its other packages would couple two stacks that
 * deploy apart, and an Elixir import of Clan would put a vertical's
 * judgment into the hub. Both directions are refused here.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLAN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ROOT = path.dirname(CLAN);
const KIT = new Set([
  "@elixir-mcp/ui",
  "@elixir-mcp/client",
  "@elixir-mcp/design",
]);
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

test("Clan imports nothing of Elixir's but the kit", async () => {
  const bad = [];
  for await (const file of files(CLAN)) {
    for (const spec of await imports(file)) {
      const rel = path.relative(CLAN, file);
      if (spec.startsWith(".")) {
        const target = path.resolve(path.dirname(file), spec);
        if (!target.startsWith(CLAN + path.sep)) bad.push(`${rel}: ${spec}`);
      } else if (
        packageOf(spec).startsWith("@elixir-mcp/") &&
        !KIT.has(packageOf(spec))
      ) {
        bad.push(`${rel}: ${spec}`);
      } else if (spec === "elixir-mcp" || spec.startsWith("elixir-mcp/")) {
        bad.push(`${rel}: ${spec}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("Elixir imports nothing of Clan's", async () => {
  const bad = [];
  for (const top of [
    "apps",
    "services",
    "packages",
    "infra",
    "acceptance",
    "clients",
  ]) {
    for await (const file of files(path.join(ROOT, top))) {
      for (const spec of await imports(file)) {
        const target = spec.startsWith(".")
          ? path.resolve(path.dirname(file), spec)
          : null;
        if (
          packageOf(spec).startsWith("@elixir-clan/") ||
          (target && target.startsWith(CLAN + path.sep))
        )
          bad.push(`${path.relative(ROOT, file)}: ${spec}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
