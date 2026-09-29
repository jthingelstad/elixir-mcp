/**
 * Services import packages, never each other (the structural assessment
 * of 2026-09-28, Phase 4; zero since 2026-09-29). A service is a Lambda's
 * door: its entry, its routes, its handler. What two services share is a
 * package, imported by name (`@elixir-mcp/tools`, `@elixir-mcp/ledger`),
 * so the dependency is in package.json where knip and a reader can see it.
 * Before this, web-api answered /api/v1 by reaching into the MCP service's
 * src and ingest's through relative paths no tool could see.
 *
 * Three rules, over src only (a test may borrow another workspace's
 * scratch database or seed helper):
 *  - no package imports a service, by path or by name;
 *  - no service's src leaves its own directory by a relative path;
 *  - no service imports another service by name.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SERVICES = path.join(ROOT, "services");
const PACKAGES = path.join(ROOT, "packages");
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

/** Every src file under each workspace in `dir`, with its workspace. */
async function* sources(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(dir, entry.name, "src");
    try {
      await readdir(src);
    } catch {
      continue;
    }
    for await (const file of files(src))
      yield { home: path.join(dir, entry.name), file };
  }
}

const nameOf = (spec) => spec.split("/").slice(0, 2).join("/");

test("no package imports a service", async () => {
  const services = await servicePackageNames();
  const bad = [];
  for await (const { file } of sources(PACKAGES)) {
    for (const spec of await imports(file)) {
      const into = spec.startsWith(".")
        ? !path
            .relative(SERVICES, path.resolve(path.dirname(file), spec))
            .startsWith("..")
        : services.has(nameOf(spec));
      if (into) bad.push(`${path.relative(ROOT, file)}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("services import packages by name, never each other", async () => {
  const services = await servicePackageNames();
  const bad = [];
  for await (const { home, file } of sources(SERVICES)) {
    const own = JSON.parse(
      await readFile(path.join(home, "package.json"), "utf8"),
    ).name;
    for (const spec of await imports(file)) {
      const out = spec.startsWith(".")
        ? path
            .relative(home, path.resolve(path.dirname(file), spec))
            .startsWith("..")
        : services.has(nameOf(spec)) && nameOf(spec) !== own;
      if (out) bad.push(`${path.relative(ROOT, file)}: ${spec}`);
    }
  }
  assert.deepEqual(
    bad,
    [],
    "share it through a package (packages/*), imported by its name",
  );
});
