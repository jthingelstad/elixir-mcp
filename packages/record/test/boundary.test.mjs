/**
 * Services import packages, never each other (the structural assessment
 * of 2026-09-28, Phase 4). A service reaching into another's src couples
 * two Lambdas' code through a relative path no tool can see: web-api
 * answered /api/v1 by importing the MCP registry and ingest's modules.
 * What they share belongs here, in @elixir-mcp/record, or in another
 * package.
 *
 * Two rules. This package imports no service, in either form. And the
 * relative imports from one service's src into another's may only go
 * DOWN: move what is shared into a package, then lower CEILING. Tests
 * are not counted; a test may borrow another service's scratch database.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CEILING = 74;

const PACKAGE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ROOT = path.resolve(PACKAGE, "../..");
const SERVICES = path.join(ROOT, "services");
const CODE = /\.(m?js|jsx|ts|tsx)$/;
const SKIP = new Set(["node_modules", "dist"]);
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(p);
    else if (CODE.test(entry.name)) yield p;
  }
}

async function imports(file) {
  const text = await readFile(file, "utf8");
  return [...text.matchAll(SPECIFIER)].map((m) => m[1]);
}

/** The service a path is inside, or null. */
function serviceOf(p) {
  const rel = path.relative(SERVICES, p);
  return rel.startsWith("..") ? null : rel.split(path.sep)[0];
}

async function servicePackageNames() {
  const names = new Set();
  for (const entry of await readdir(SERVICES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const pkg = JSON.parse(
        await readFile(path.join(SERVICES, entry.name, "package.json"), "utf8"),
      );
      names.add(pkg.name);
    } catch {
      // a directory without a package is not a service
    }
  }
  return names;
}

test("@elixir-mcp/record imports no service", async () => {
  const services = await servicePackageNames();
  const bad = [];
  for await (const file of files(path.join(PACKAGE, "src"))) {
    for (const spec of await imports(file)) {
      const rel = path.relative(PACKAGE, file);
      if (spec.startsWith(".")) {
        const target = path.resolve(path.dirname(file), spec);
        if (!target.startsWith(PACKAGE + path.sep)) bad.push(`${rel}: ${spec}`);
      } else if (services.has(spec.split("/").slice(0, 2).join("/"))) {
        bad.push(`${rel}: ${spec}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test(`cross-service imports in services' src never exceed ${CEILING}`, async () => {
  const crossings = [];
  for (const service of await readdir(SERVICES)) {
    const src = path.join(SERVICES, service, "src");
    try {
      await readdir(src);
    } catch {
      continue;
    }
    for await (const file of files(src)) {
      for (const spec of await imports(file)) {
        if (!spec.startsWith(".")) continue;
        const target = serviceOf(path.resolve(path.dirname(file), spec));
        if (target && target !== service)
          crossings.push(`${path.relative(ROOT, file)}: ${spec}`);
      }
    }
  }
  assert.ok(
    crossings.length <= CEILING,
    `${crossings.length} relative imports cross from one service into another (ceiling ${CEILING}); share it through a package instead:\n${crossings.join("\n")}`,
  );
});
