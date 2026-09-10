/**
 * Build elixir.poapkings.com: two builds, one directory.
 *
 * The site is split in half (2026-09-07). apps/site is an Eleventy build
 * that emits real HTML documents for everything that is CONTENT - home,
 * docs, updates, the contract changelog - plus the machine-readable
 * surfaces (llms.txt, llms-full.txt, tools.json, sitemap.xml, feed.xml).
 * apps/web is the React application for everything behind a session or
 * drawn live at read time. Both are served from one bucket behind one
 * distribution, and the CloudFront function in infra/template.yaml
 * decides which one answers a path.
 *
 * This script produces the merged tree and REFUSES to produce a broken
 * one: an unresolvable sitemap entry, a dangling link in llms.txt, a
 * missing app shell or a missing asset all fail the build here rather
 * than on the live site. That check is the reason the merge is a script
 * and not two `aws s3 sync` calls.
 *
 *   node infra/scripts/build-site.mjs [--out dist/site] [--skip-stats]
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const args = process.argv.slice(2);
const outDir = path.resolve(
  repoRoot,
  args.includes("--out") ? args[args.indexOf("--out") + 1] : "dist/site",
);
const skipStats = args.includes("--skip-stats");

const siteDist = path.join(repoRoot, "apps/site/dist");
const webDist = path.join(repoRoot, "apps/web/dist");

function run(cmd, cmdArgs, env = {}) {
  execFileSync(cmd, cmdArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

/** Every file in a tree, as paths relative to its root. */
function walk(root, base = root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

// 1. Build both halves ------------------------------------------------------
// The contract and the docs corpus first: the tool reference imports the
// registry, and the registry now serves the corpus.
console.error("building the contract and the docs corpus...");
run("npm", ["run", "build"]);
console.error("building the app (apps/web)...");
run("npm", ["run", "build", "-w", "@elixir-mcp/web"]);

// Eleventy does not clean its own output, so a page or an asset that has
// been DELETED from src stays in apps/site/dist and is copied into the
// merged tree by the step below — uploaded, live, and referenced by
// nothing. It hid a real defect on 2026-09-10: the access-request form
// moved into the app, and its script kept being deployed. Clean first,
// so what ships is what the source says.
rmSync(siteDist, { recursive: true, force: true });
console.error("building the static site (apps/site)...");
run(
  "npm",
  ["run", "build", "-w", "@elixir-mcp/site"],
  skipStats ? { ELIXIR_SKIP_STATS: "1" } : {},
);

// 2. Merge ------------------------------------------------------------------
// The static site is the base: it owns the root document. The app's
// build is layered in, and its shell is renamed to app.html - the path
// the edge router rewrites app-owned routes to.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(siteDist, outDir, { recursive: true });

const siteFiles = new Set(walk(outDir));
const collisions = [];
for (const rel of walk(webDist)) {
  if (rel === "index.html") continue; // handled below as app.html
  if (siteFiles.has(rel)) {
    const a = readFileSync(path.join(webDist, rel));
    const b = readFileSync(path.join(outDir, rel));
    if (!a.equals(b)) collisions.push(rel);
    continue;
  }
  const dest = path.join(outDir, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(path.join(webDist, rel), dest);
}
if (collisions.length > 0) {
  // Two halves writing different bytes to one path means whichever
  // build ran last wins, silently. Name them instead.
  throw new Error(
    `both builds emit different content at: ${collisions.join(", ")}`,
  );
}

// Vite always names its shell after the input file. Renaming here keeps
// `vite dev` working normally on index.html.
if (!existsSync(path.join(webDist, "index.html"))) {
  throw new Error("apps/web build produced no index.html");
}
cpSync(path.join(webDist, "index.html"), path.join(outDir, "app.html"));

// 3. Verify -----------------------------------------------------------------
const files = new Set(walk(outDir));
const problems = [];

/** Resolve a site path the way the edge router does. */
function resolves(urlPath) {
  const clean = urlPath.split("#")[0].split("?")[0];
  if (!clean.startsWith("/")) return true; // external
  const rel = clean.replace(/^\//, "");
  if (rel === "") return files.has("index.html");
  if (path.basename(rel).includes(".")) return files.has(rel);
  return files.has(path.join(rel, "index.html"));
}

if (!files.has("app.html")) problems.push("app.html is missing");
for (const required of [
  "index.html",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  "llms-full.txt",
  "tools.json",
  "feed.xml",
  "assets/site.css",
  "assets/og.png",
]) {
  if (!files.has(required)) problems.push(`${required} is missing`);
}

// The shared stylesheet must be the one in packages/design, not a copy
// that drifted.
const designCss = path.join(repoRoot, "packages/design/styles.css");
if (
  files.has("assets/site.css") &&
  !readFileSync(designCss).equals(
    readFileSync(path.join(outDir, "assets/site.css")),
  )
) {
  problems.push("assets/site.css differs from packages/design/styles.css");
}

// Every asset the app shell references must have been merged in.
const shell = readFileSync(path.join(outDir, "app.html"), "utf8");
for (const m of shell.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
  if (!resolves(m[1])) problems.push(`app.html references missing ${m[1]}`);
}

// Every sitemap entry must be a page that exists.
const sitemap = readFileSync(path.join(outDir, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (locs.length === 0) problems.push("sitemap.xml lists no pages");
for (const loc of locs) {
  const urlPath = loc.replace(/^https?:\/\/[^/]+/, "") || "/";
  if (!resolves(urlPath)) problems.push(`sitemap lists missing ${urlPath}`);
}

// Every same-site link in llms.txt must resolve. An agent following a
// dead link here is the failure this file exists to prevent. /api/*
// paths are served by the API, not from this bucket.
const llms = readFileSync(path.join(outDir, "llms.txt"), "utf8");
for (const m of llms.matchAll(
  /\]\((https:\/\/elixir\.poapkings\.com[^)]*)\)/g,
)) {
  const urlPath = m[1].replace(/^https?:\/\/[^/]+/, "") || "/";
  if (urlPath.startsWith("/api/") || urlPath === "/mcp") continue;
  if (!resolves(urlPath)) problems.push(`llms.txt links missing ${urlPath}`);
}

if (problems.length > 0) {
  console.error("\nsite build FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.error(
  `\nsite built: ${files.size} files in ${path.relative(repoRoot, outDir)} ` +
    `(${locs.length} indexable pages + the app shell)`,
);
