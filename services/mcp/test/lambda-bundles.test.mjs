// What a Lambda's cold start parses (docs/notes/2026-10-21-web-api-cold-start.md):
// the bundles are built here with build.mjs's own options, in memory.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  LAMBDAS,
  esbuildOptions,
  repoRoot,
} from "../../../infra/scripts/build.mjs";

const lambda = (name) => LAMBDAS.find((l) => l.name === name);

async function bundle(name, outDir = path.join(tmpdir(), `bundle-${name}`)) {
  const result = await build({
    ...esbuildOptions(lambda(name), outDir),
    write: false,
    metafile: true,
  });
  const outputs = result.metafile.outputs;
  const entry = Object.keys(outputs).find((k) => k.endsWith("/index.mjs"));
  // The entry and every chunk it imports statically: what an import of
  // index.mjs parses before the door listens.
  const atInit = new Set();
  for (const queue = [entry]; queue.length;) {
    const file = queue.shift();
    if (atInit.has(file)) continue;
    atInit.add(file);
    for (const i of outputs[file].imports)
      if (i.kind === "import-statement" && outputs[i.path]) queue.push(i.path);
  }
  const inputsOf = (files) =>
    new Set(files.flatMap((f) => Object.keys(outputs[f].inputs)));
  return {
    result,
    atInit: inputsOf([...atInit]),
    all: inputsOf(Object.keys(outputs)),
  };
}

const has = (inputs, part) => [...inputs].some((i) => i.includes(part));

test("web-api: a cold start parses no server rendering, no icon set and no docs corpus", async () => {
  const { atInit, all } = await bundle("web-api");
  for (const part of [
    "apps/web/src/App.jsx",
    "react-dom/",
    "node_modules/lucide-react/",
    "packages/docs/dist/corpus.json",
  ])
    assert.ok(!has(atInit, part), part);
  // They are still in the bundle, read on first use.
  assert.ok(has(all, "apps/web/src/entry-server.jsx"));
  assert.ok(has(all, "packages/docs/dist/corpus.json"));
  // lucide-react resolves to its per-icon ES modules, never its CommonJS
  // main with every icon in one file.
  assert.ok(has(all, "node_modules/lucide-react/dist/esm/"));
  assert.ok(!has(all, "node_modules/lucide-react/dist/cjs/"));
});

test("the docs corpus rides only the bundles that can call the docs tools", async () => {
  const carries = Object.fromEntries(
    await Promise.all(
      ["mcp", "jobs", "migrate"].map(async (name) => [
        name,
        has((await bundle(name)).all, "packages/docs/dist/corpus.json"),
      ]),
    ),
  );
  // migrate's profile_tool op takes any read-only tool, the docs tools
  // included (Codex on #623).
  assert.deepEqual(carries, { mcp: true, jobs: false, migrate: true });
});

test("a bundle is the same bytes every build", async () => {
  const dir = path.join(tmpdir(), "bundle-repeat");
  const files = async () =>
    Object.fromEntries(
      (await bundle("web-api", dir)).result.outputFiles.map((f) => [
        f.path,
        f.hash,
      ]),
    );
  assert.deepEqual(await files(), await files());
});

test("a bundle without the corpus refuses a docs read by name", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "corpus-probe-"));
  try {
    const entry = path.join(dir, "probe.mjs");
    await writeFile(
      entry,
      `export { corpus } from ${JSON.stringify(path.join(repoRoot, "packages/docs/src/index.mjs"))};\n`,
    );
    const load = async (opts, out) => {
      await build({
        ...esbuildOptions({ name: "probe", entry, ...opts }, out),
        entryPoints: { index: entry },
        logLevel: "silent",
      });
      return import(pathToFileURL(path.join(out, "index.mjs")).href);
    };
    const without = await load({}, path.join(dir, "without"));
    await assert.rejects(without.corpus(), /docs_corpus_not_bundled/);
    const carried = await load(
      { docs: true, split: true },
      path.join(dir, "with"),
    );
    assert.ok((await carried.corpus()).docs.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
