#!/usr/bin/env node
/**
 * Bundle every Lambda with esbuild into infra/dist/<name>/ and zip it.
 * ESM output (nodejs24.x native) with the createRequire banner so CJS deps
 * like pg resolve; web functions bundle the SDK (no runtime SDK assumption);
 * pg-native is an optional dep that must stay external. The migrate bundle
 * carries db/migrations alongside the code. The doors (web-api, mcp) are
 * split: what a cold start does not need is a chunk beside index.mjs,
 * read on first use (docs/notes/2026-10-21-web-api-cold-start.md).
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHARE_FILES,
  shareSources,
} from "../../services/web-api/src/share-files.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../..");
const distRoot = path.join(repoRoot, "infra/dist");

export const WEB_ROUTER_ALIAS = {
  "@tanstack/router-core/isServer": path.join(
    path.dirname(
      fileURLToPath(import.meta.resolve("@tanstack/router-core/isServer")),
    ),
    "development.js",
  ),
};

/** lucide-react has no `exports` map, so esbuild's node resolution took
 *  its CommonJS `main`: every icon (about 1.1 MB) parsed and defined on
 *  each cold start. Its `module` build is per-icon ES modules marked
 *  free of side effects, so the bundle keeps only the icons the kit
 *  names. Only this package is pointed at its `module`: a global
 *  `mainFields` change also moves the AWS SDK from dist-cjs to dist-es,
 *  a resolution no test runs (docs/notes/2026-10-21-web-api-cold-start.md). */
function moduleEntry(pkg, dependent) {
  const manifest = createRequire(
    path.join(repoRoot, dependent, "package.json"),
  ).resolve(`${pkg}/package.json`);
  const { module } = JSON.parse(readFileSync(manifest, "utf8"));
  if (!module) throw new Error(`${pkg} has no module entry`);
  return path.join(path.dirname(manifest), module);
}
export const MODULE_ALIAS = {
  "lucide-react": moduleEntry("lucide-react", "packages/ui"),
};

/** The docs corpus (packages/docs, about 1.4 MB) is read by the docs
 *  tools and the MCP door's resources. Only the doors that can answer
 *  them carry it; in the others the registry still names those tools,
 *  and calling one fails with this error instead of a wrong answer. */
const WITHOUT_CORPUS = {
  name: "without-docs-corpus",
  setup(b) {
    b.onResolve({ filter: /\/corpus\.json$/ }, ({ importer }) =>
      importer.endsWith(path.join("packages", "docs", "src", "index.mjs"))
        ? { path: "corpus.json", namespace: "without-docs-corpus" }
        : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: "without-docs-corpus" }, () => ({
      contents:
        'throw new Error("docs_corpus_not_bundled: this Lambda does not carry the docs corpus (infra/scripts/build.mjs)");',
      loader: "js",
    }));
  },
};

// `db`: the function connects to PostgreSQL, so its bundle carries the
// RDS root certificates and its DATABASE_URL says sslmode=verify-full
// (#71; infra/template.yaml sets NODE_EXTRA_CA_CERTS to this file).
// `docs`: it can answer the docs tools, so it carries the docs corpus.
// `split`: its lazy imports (server rendering, the corpus) are chunks of
// their own beside index.mjs, read when first used rather than parsed at
// every cold start.
export const LAMBDAS = [
  {
    name: "web-api",
    entry: "services/web-api/src/index.mjs",
    db: true,
    docs: true,
    split: true,
  },
  {
    name: "mcp",
    entry: "services/mcp/src/index.mjs",
    db: true,
    docs: true,
    split: true,
  },
  { name: "scheduler", entry: "services/scheduler/src/index.mjs", db: true },
  { name: "email-relay", entry: "services/email-relay/src/index.mjs" },
  { name: "migrate", entry: "services/migrate/src/lambda.mjs", db: true },
  { name: "jobs", entry: "services/jobs/src/index.mjs", db: true },
  { name: "collector", entry: "services/collector/src/index.mjs", db: true },
  {
    name: "timeline-sync",
    entry: "services/timeline-sync/src/index.mjs",
    db: true,
  },
];

/** The us-east-1 RDS root CAs (rsa2048, rsa4096 and ecc384 G1), from
 *  https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem.
 *  Roots only, as RDS asks: the server sends its intermediate, and a
 *  pinned intermediate breaks when RDS rotates the server certificate.
 *  The roots expire in 2061 and later. */
export const RDS_CA_BUNDLE = "infra/certificates/rds-us-east-1-bundle.pem";
/** Where the bundle sits in a DB function's package: /var/task/... */
export const RDS_CA_PATH = "certificates/rds.pem";

/** What the docs corpus is made from: its pages, the site data and
 *  renderer they resolve against, and the packages that data reads. */
export const CORPUS_SOURCES = [
  "apps/site/src/docs",
  "apps/site/src/_data",
  "apps/site/src/_lib",
  "packages/docs",
  "packages/tools",
  "packages/contracts",
];

/** The corpus stamps its build time and renders the site's `build`
 *  dates (docs/limits.md's reset example), so left to the clock every
 *  build of unchanged docs differed, and so did the bundles that carry
 *  the corpus (deploy-lane.mjs names a bundle by its content).
 *  SOURCE_DATE_EPOCH (reproducible-builds.org) pins both to the last
 *  commit that touched the corpus's sources; a caller's own value wins,
 *  and without git the clock stands. */
export function sourceDateEpoch() {
  if (process.env.SOURCE_DATE_EPOCH) return process.env.SOURCE_DATE_EPOCH;
  try {
    const at = execFileSync(
      "git",
      ["log", "-1", "--format=%ct", "--", ...CORPUS_SOURCES],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return /^\d+$/.test(at) ? at : undefined;
  } catch {
    return undefined;
  }
}

/** esbuild's options for one Lambda, writing into `outDir`.
 *  @param {{ name: string, entry: string, docs?: boolean, split?: boolean }} lambda
 *  @param {string} [outDir]
 *  @returns {import("esbuild").BuildOptions} */
export function esbuildOptions(
  { name, entry, docs = false, split = false },
  outDir = path.join(distRoot, name),
) {
  return {
    entryPoints: { index: path.join(repoRoot, entry) },
    // Paths in the bundle's comments are relative to this, so a build
    // from another directory or worktree gives the same bytes.
    absWorkingDir: repoRoot,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    // Chunks sit beside index.mjs, so a module's import.meta.url (the
    // share files, app.html, geo/) names the same directory wherever
    // esbuild places it. Named by content: the same source, the same
    // files.
    splitting: split,
    chunkNames: "chunk-[hash]",
    plugins: docs ? [] : [WITHOUT_CORPUS],
    external: ["web-api", "mcp", "collector"].includes(name)
      ? ["pg-native"]
      : ["@aws-sdk/*", "pg-native"],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    define:
      name === "web-api"
        ? { "process.env.NODE_ENV": JSON.stringify("production") }
        : {},
    loader: { ".css": "empty", ".png": "dataurl" },
    // Our universal tree uses explicit memory history on the server and
    // serializes query envelopes, not TanStack's streaming SSR protocol.
    // Use the environment-neutral export so explicit isServer governs
    // render boundaries while DOM-only work still checks for a document.
    alias:
      name === "web-api"
        ? { ...MODULE_ALIAS, ...WEB_ROUTER_ALIAS }
        : MODULE_ALIAS,
    sourcemap: false,
    minify: false,
    logLevel: "error",
  };
}

export async function buildAll() {
  // The contract (dist/*.js) and the docs corpus (dist/corpus.json) are
  // generated; the MCP bundle imports both, so they are built first.
  const epoch = sourceDateEpoch();
  execFileSync("npm", ["run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: epoch ? { ...process.env, SOURCE_DATE_EPOCH: epoch } : process.env,
  });
  execFileSync("npm", ["run", "build", "-w", "@elixir-mcp/web"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  await rm(distRoot, { recursive: true, force: true });
  const artifacts = [];
  for (const lambda of LAMBDAS) {
    const { name, db } = lambda;
    const outDir = path.join(distRoot, name);
    await mkdir(outDir, { recursive: true });
    await build(esbuildOptions(lambda, outDir));
    if (name === "web-api") {
      await cp(
        path.join(repoRoot, "apps/web/dist/index.html"),
        path.join(outDir, "app.html"),
      );
      // A battle's share picture is drawn in the function: resvg's wasm
      // and the fonts sit beside the code, read on the first picture.
      await mkdir(path.join(outDir, "share"), { recursive: true });
      await cp(
        path.join(repoRoot, "packages/clan-engine/geo"),
        path.join(outDir, "geo"),
        { recursive: true },
      );
      const sources = shareSources();
      for (const [k, file] of Object.entries(SHARE_FILES))
        await cp(sources[k], path.join(outDir, "share", file));
    }
    if (db) {
      await mkdir(path.join(outDir, path.dirname(RDS_CA_PATH)), {
        recursive: true,
      });
      await cp(
        path.join(repoRoot, RDS_CA_BUNDLE),
        path.join(outDir, RDS_CA_PATH),
      );
    }
    if (name === "migrate") {
      await cp(
        path.join(repoRoot, "db/migrations"),
        path.join(outDir, "migrations"),
        {
          recursive: true,
        },
      );
    }
    const zipPath = path.join(distRoot, `${name}.zip`);
    execFileSync("zip", ["-qr", zipPath, "."], { cwd: outDir });
    artifacts.push({ name, zipPath, dir: outDir });
  }
  return artifacts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifacts = await buildAll();
  for (const a of artifacts) console.log(`built ${a.zipPath}`);
}
