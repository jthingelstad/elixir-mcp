/**
 * What the browser journeys (apps/web/e2e) read from the repository
 * besides the built tree, so the test of infra/scripts/e2e-needed.sh can
 * ask that script about each one: a `false` for any of them would skip
 * the journeys on a pull request that can break them.
 *
 * - `specClosure`: every repository file in the static import closure of
 *   the specs, plus the entries a spec bundles itself (an esbuild
 *   `entryPoints: [path.join(repoRoot, "<file>")]`, as native-ssr does).
 *   Packages outside the workspace are left out; `@elixir-mcp/*` is
 *   followed to its source.
 * - `openedDocs`: the doc pages a journey opens by name
 *   (`page.goto("/docs/<slug>")`), as their Markdown sources.
 */
import { build } from "esbuild";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const E2E = "apps/web/e2e";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function specs(repoRoot) {
  return walk(path.join(repoRoot, E2E))
    .filter((f) => f.endsWith(".ts"))
    .sort();
}

/** Repository-relative paths, sorted. */
export async function specClosure(repoRoot) {
  const entries = new Set(specs(repoRoot));
  for (const file of specs(repoRoot))
    for (const m of readFileSync(file, "utf8").matchAll(
      /path\.join\(\s*repoRoot,\s*"([^"]+\.m?[jt]sx?)"\s*\)/g,
    ))
      entries.add(path.join(repoRoot, m[1]));
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [...entries],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    outdir: "e2e-closure",
    logLevel: "silent",
    loader: { ".css": "empty", ".png": "dataurl" },
    plugins: [
      {
        name: "workspace-only",
        setup(b) {
          b.onResolve({ filter: /^[^./]/ }, (args) =>
            args.path.startsWith("@elixir-mcp/")
              ? undefined
              : { path: args.path, external: true },
          );
        },
      },
    ],
  });
  return Object.keys(result.metafile.inputs)
    .filter((f) => !f.includes("node_modules/") && !f.startsWith(".."))
    .sort();
}

/** The Markdown source of each doc page a journey opens by name. */
export function openedDocs(repoRoot) {
  const slugs = new Set();
  for (const file of specs(repoRoot))
    for (const m of readFileSync(file, "utf8").matchAll(
      /goto\(\s*["'`]\/docs\/([a-z0-9-]+)/g,
    ))
      slugs.add(m[1]);
  return [...slugs]
    .map((slug) => `apps/site/src/docs/${slug}.md`)
    .filter((rel) => existsSync(path.join(repoRoot, rel)))
    .sort();
}
