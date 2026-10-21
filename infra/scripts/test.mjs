#!/usr/bin/env node
/**
 * Every workspace test, run the same way by `npm test` (and so by
 * `npm run verify`) and by CI's test shards.
 *
 *   node infra/scripts/test.mjs                  every unit, a bounded pool
 *   node infra/scripts/test.mjs --shard 2/3      the units shard 2 of 3 holds
 *   node infra/scripts/test.mjs --jobs 2         a smaller pool
 *   node infra/scripts/test.mjs web tools        only these units
 *   node infra/scripts/test.mjs --list --shard 1/3   the plan; runs nothing
 *
 * A unit is a workspace with a `test` script (named by its directory:
 * `web`, `tools`, `clan-web`) plus `root`, the repository's own
 * `docs/*.test.mjs` and `acceptance/**\/*.test.mjs`.
 *
 * The build runs ONCE, first: `npm run build` (design, contracts, docs),
 * or the merged site tree (build-site.mjs, which runs that build too)
 * when the `site` unit is selected. Each unit then runs as
 * `npm test --ignore-scripts -w <workspace>`, which skips the
 * workspace's own `pretest`: a workspace that needs a build for a
 * focused `npm test -w` run says so in `pretest`, and here that build has
 * already happened. Tests therefore only READ built output; a test that
 * rebuilt the contract while another workspace imported it would be a
 * race. Units share nothing else: each scratch database is named for the
 * test process (`elixir_mcp_test_<name>_<pid>`) and servers listen on
 * port 0.
 *
 * Output is held per unit and printed whole when the unit ends (folded in
 * a GitHub Actions group when it passed), then a summary by duration.
 * Exit 1 if any unit failed.
 *
 * Shards are balanced on WEIGHTS, the units' measured CI seconds:
 * longest first, each to the lightest shard, ties by name, so a shard's
 * contents change only when a weight or a unit does. A unit not in the
 * table weighs DEFAULT_WEIGHT; add it when the summary shows its time.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Measured seconds per unit in CI's serial verify job, main run
 *  39544910068 (2026-10-21), rounded; `root` and `site` estimated from
 *  the same log. Only the order and rough size matter. */
export const WEIGHTS = {
  web: 41,
  tools: 33,
  migrate: 21,
  "clan-web": 20,
  "web-api": 20,
  ingest: 16,
  jobs: 13,
  mcp: 11,
  site: 9,
  syndication: 7,
  ui: 6,
  claims: 3,
  record: 3,
  scheduler: 3,
  clan: 2,
  contracts: 2,
  design: 2,
  root: 2,
};
export const DEFAULT_WEIGHT = 1;

/** Every unit: the workspaces with a test script, then `root`. */
export function units(root = repoRoot) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const out = [];
  for (const pattern of pkg.workspaces) {
    const parent = path.join(root, pattern.replace(/\/\*$/, ""));
    for (const dir of readdirSync(parent).sort()) {
      const file = path.join(parent, dir, "package.json");
      if (!existsSync(file)) continue;
      const ws = JSON.parse(readFileSync(file, "utf8"));
      if (!ws.scripts?.test) continue;
      out.push({ name: dir, workspace: ws.name });
    }
  }
  out.push({ name: "root", workspace: null });
  return out;
}

/** "2/3" -> { index: 2, count: 3 }; anything else throws. */
export function parseShard(text) {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? "");
  const index = Number(m?.[1]);
  const count = Number(m?.[2]);
  if (!m || count < 1 || index < 1 || index > count)
    throw new Error(`--shard wants i/n with 1 <= i <= n, not "${text}"`);
  return { index, count };
}

/** Longest-first onto the lightest shard. Returns `count` arrays of unit
 *  names, each heaviest first. Deterministic for a given unit list. */
export function plan(names, count, weights = WEIGHTS) {
  const weight = (n) => weights[n] ?? DEFAULT_WEIGHT;
  const order = [...names].sort(
    (a, b) => weight(b) - weight(a) || a.localeCompare(b),
  );
  const shards = Array.from({ length: count }, () => ({ load: 0, names: [] }));
  for (const name of order) {
    const lightest = shards.reduce((best, s) =>
      s.load < best.load ? s : best,
    );
    lightest.names.push(name);
    lightest.load += weight(name);
  }
  return shards.map((s) => s.names);
}

/** The default pool: half the cores, at least 2 and at most 6. Each unit
 *  already runs its own files in parallel (node --test and vitest both
 *  use the cores), and every scratch-database file holds connections
 *  against Postgres's default 100. */
export function defaultJobs(cores = os.availableParallelism()) {
  return Math.max(2, Math.min(6, Math.floor(cores / 2)));
}

function parseArgs(argv) {
  const opts = { jobs: defaultJobs(), shard: null, list: false, only: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const eq = a.indexOf("=");
      if (eq >= 0) return a.slice(eq + 1);
      i += 1;
      return argv[i];
    };
    if (a === "--list") opts.list = true;
    else if (a.startsWith("--shard")) opts.shard = parseShard(value());
    else if (a.startsWith("--jobs")) {
      opts.jobs = Number(value());
      if (!Number.isInteger(opts.jobs) || opts.jobs < 1)
        throw new Error("--jobs wants a whole number of at least 1");
    } else if (a === "-h" || a === "--help") opts.help = true;
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else opts.only.push(a);
  }
  return opts;
}

/** The Node major this repository runs on (.node-version), so a local
 *  run on another major says so instead of passing on a runtime that
 *  CI and Lambda do not use. */
export function nodeMismatch(version = process.versions.node, root = repoRoot) {
  const want = readFileSync(path.join(root, ".node-version"), "utf8").trim();
  const have = version.split(".")[0];
  return have === want.split(".")[0] ? null : { want, have: version };
}

function warnNode() {
  const m = nodeMismatch();
  if (!m) return;
  const bar = "!".repeat(72);
  console.error(
    `${bar}\n! Node ${m.have} is running; this repository, CI and Lambda run Node ${m.want}.\n` +
      `! A pass here is not a pass on ${m.want}. Put Node ${m.want} first on PATH, e.g.\n` +
      `!   export PATH="/opt/homebrew/opt/node@${m.want}/bin:$PATH"\n${bar}`,
  );
}

const inActions = process.env.GITHUB_ACTIONS === "true";

function run(cmd, args, label) {
  console.error(`test: ${label}`);
  const r = spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`test: ${label} failed (exit ${r.status ?? r.signal})`);
    process.exit(1);
  }
}

function runUnit(unit) {
  const [cmd, args] = unit.workspace
    ? ["npm", ["test", "--ignore-scripts", "-w", unit.workspace]]
    : ["node", ["--test", "docs/*.test.mjs", "acceptance/**/*.test.mjs"]];
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "0" },
    });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    child.on("close", (code, signal) =>
      resolve({
        ...unit,
        ok: code === 0,
        exit: code ?? signal,
        seconds: (Date.now() - started) / 1000,
        output: Buffer.concat(chunks).toString("utf8"),
      }),
    );
  });
}

function report(r) {
  const head = `${r.ok ? "ok  " : "FAIL"} ${r.name} (${r.seconds.toFixed(1)} s)`;
  if (inActions && r.ok) {
    process.stdout.write(`::group::${head}\n${r.output}\n::endgroup::\n`);
    return;
  }
  process.stdout.write(`\n──── ${head} ────\n${r.output}\n`);
  if (inActions && !r.ok)
    process.stdout.write(
      `::error title=test ${r.name}::${r.name} failed (exit ${r.exit})\n`,
    );
}

async function pool(list, jobs) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const unit = list[next++];
      const r = await runUnit(unit);
      report(r);
      results.push(r);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(jobs, list.length) }, worker),
  );
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), "utf8")
        .split("\n")
        .slice(2, 13)
        .map((l) => l.replace(/^ \* ?/, ""))
        .join("\n"),
    );
    return;
  }
  const all = units();
  const known = new Set(all.map((u) => u.name));
  for (const n of opts.only)
    if (!known.has(n))
      throw new Error(`no unit "${n}"; units: ${[...known].join(", ")}`);
  let names = opts.only.length ? opts.only : all.map((u) => u.name);
  if (opts.shard) names = plan(names, opts.shard.count)[opts.shard.index - 1];
  // Heaviest first, so the long units start while the short ones fill in.
  const weight = (n) => WEIGHTS[n] ?? DEFAULT_WEIGHT;
  const chosen = all
    .filter((u) => names.includes(u.name))
    .sort(
      (a, b) => weight(b.name) - weight(a.name) || a.name.localeCompare(b.name),
    );
  const where = opts.shard
    ? `shard ${opts.shard.index}/${opts.shard.count}: `
    : "";
  console.error(
    `test: ${where}${chosen.length} units, ${opts.jobs} at a time: ${chosen.map((u) => u.name).join(" ")}`,
  );
  if (opts.list) return;
  warnNode();

  const started = Date.now();
  if (chosen.some((u) => u.name === "site"))
    run(
      "node",
      ["infra/scripts/build-site.mjs", "--skip-stats"],
      "build the site tree (and the packages it needs)",
    );
  else run("npm", ["run", "build"], "build the packages tests read");

  const results = await pool(chosen, opts.jobs);
  const failed = results.filter((r) => !r.ok);
  const wall = (Date.now() - started) / 1000;
  const sum = results.reduce((s, r) => s + r.seconds, 0);
  console.log(
    `\n${where}${results.length} units in ${wall.toFixed(1)} s (${sum.toFixed(1)} s of unit time, ${opts.jobs} at a time)`,
  );
  for (const r of [...results].sort((a, b) => b.seconds - a.seconds))
    console.log(
      `  ${r.ok ? "ok  " : "FAIL"} ${r.seconds.toFixed(1).padStart(6)} s  ${r.name}`,
    );
  if (failed.length) {
    console.log(
      `\n${failed.length} failed: ${failed.map((r) => r.name).join(", ")}`,
    );
    process.exitCode = 1;
  }
  warnNode();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((err) => {
    console.error(`test: ${err.message}`);
    process.exit(2);
  });
