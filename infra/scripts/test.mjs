#!/usr/bin/env node
/**
 * Every workspace test, run the same way by `npm test` (and so by
 * `npm run verify`) and by CI's test shards.
 *
 *   node infra/scripts/test.mjs                  every unit, a bounded pool
 *   node infra/scripts/test.mjs --shard 2/3      the units shard 2 of 3 holds
 *   node infra/scripts/test.mjs --jobs 2         a smaller pool
 *   node infra/scripts/test.mjs --db-slots 4     fewer scratch databases at once
 *   node infra/scripts/test.mjs web tools        only these units
 *   node infra/scripts/test.mjs --list --shard 1/3   the plan; runs nothing
 *
 * A unit is a workspace with a `test` script (named by its directory:
 * `web`, `tools`, `web-api`) plus `root`, the repository's own
 * `docs/*.test.mjs` and `acceptance/**\/*.test.mjs`.
 *
 * The build runs ONCE, first: `npm run build` (design, contracts, docs),
 * or the merged site tree (build-site.mjs, which runs that build too)
 * when the `site` unit is selected. Each unit then runs its workspace's
 * `test` script itself (`unitCommand`): `sh -c` in the workspace's
 * directory with its `node_modules/.bin` and the root's on PATH, as npm
 * runs a script, but with no npm process. It skips the workspace's own
 * `pretest`: a workspace that needs a build for a focused `npm test -w`
 * run says so in `pretest`, and here that build has already happened.
 * No npm per unit because npm sets `process.title`, and on macOS libuv
 * then checks in with LaunchServices, which now and then calls abort():
 * the unit died of SIGABRT in 0.1 s with no output (2026-11-14,
 * docs/notes/2026-11-14-test-runner-silent-unit.md). Tests therefore only READ built output; a test that
 * rebuilt the contract while another workspace imported it would be a
 * race. Units share nothing else: each scratch database is named for the
 * test process (`elixir_mcp_test_<name>_<pid>`) and servers listen on
 * port 0.
 *
 * One cap is shared: scratch databases. Every test file that holds one
 * also holds its connections, and several sessions' verify runs share one
 * local PostgreSQL (max_connections 100). The run makes a slot directory
 * and hands it to every unit (ELIXIR_TEST_DB_SLOTS_DIR,
 * ELIXIR_TEST_DB_SLOTS); `createScratch` in
 * packages/ingest/test/helpers.mjs waits for a free slot before it clones
 * a database, so the run holds at most DB_SLOTS of them at once, whatever
 * the units and node --test's own file concurrency would start. Files
 * with no database never wait.
 *
 * Every `node --test` unit (each workspace script starting `node --test`,
 * and root) runs with two reporters: `spec`, and
 * lib/every-file-reported.mjs, which fails the unit when any test file's
 * report arrived short of the tests that file says it ran, and prints a
 * line saying it checked. A node unit that exits 0 without that line is
 * a failure too. No unit uses --test-force-exit: it let a file's process
 * exit with its last results still queued on the pipe to node's parent,
 * and node counted the short report as a pass (259 of 267, #1052,
 * docs/notes/2026-11-14-test-count-integrity.md). vitest units are not
 * counted this way: vitest fails a test whose worker exits mid-file.
 *
 * Output is held per unit and printed whole when the unit ends (folded in
 * a GitHub Actions group when it passed), then a summary by duration.
 * A failed unit always says how it ended (its exit code or the signal
 * that killed it, and that it printed nothing when it did not), so a
 * failure is never a bare FAIL. Exit 1 if any unit failed.
 *
 * Shards are balanced on WEIGHTS, the units' measured CI seconds:
 * longest first, each to the lightest shard, ties by name, so a shard's
 * contents change only when a weight or a unit does. A unit not in the
 * table weighs DEFAULT_WEIGHT; add it when the summary shows its time.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MARK } from "./lib/every-file-reported.mjs";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Measured seconds per unit in CI's serial verify job, main run
 *  39544910068 (2026-10-21), rounded; `root` and `site` estimated from
 *  the same log. Only the order and rough size matter. */
export const WEIGHTS = {
  web: 61,
  tools: 33,
  migrate: 21,
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
      out.push({
        name: dir,
        workspace: ws.name,
        dir: path.join(parent, dir),
        script: ws.scripts.test,
      });
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

/** Scratch databases one run may hold at once. A file holding one keeps
 *  about two connections (its own client, a handler's pool) and briefly
 *  a third (the admin client that clones or drops it), so ten keep a
 *  run near 20 of PostgreSQL's 100: room for four runs side by side.
 *  Measured 2026-11-13 (docs/notes/2026-11-13-test-db-slots.md). */
export const DEFAULT_DB_SLOTS = 10;

function parseArgs(argv) {
  const opts = {
    jobs: defaultJobs(),
    dbSlots: DEFAULT_DB_SLOTS,
    shard: null,
    list: false,
    only: [],
  };
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
    } else if (a.startsWith("--db-slots")) {
      opts.dbSlots = Number(value());
      if (!Number.isInteger(opts.dbSlots) || opts.dbSlots < 1)
        throw new Error("--db-slots wants a whole number of at least 1");
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

/** A `node --test` unit's script: `node --test` first, then its own
 *  flags and files. Every node test unit has that shape, so the runner
 *  can add its reporters (and a test pins the shape). */
export const NODE_TEST = /^node --test(?=\s|$)/;

/** The reporters every `node --test` unit runs with: `spec` for people,
 *  and every-file-reported.mjs, which fails the unit when a test file's
 *  report arrived short and prints MARK when it ran (#1052). */
export function reporterArgs(root = repoRoot) {
  return [
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    `--test-reporter=${path.join(root, "infra/scripts/lib/every-file-reported.mjs")}`,
    "--test-reporter-destination=stdout",
  ];
}

/** The script with the reporters after `node --test`; a script of any
 *  other shape (vitest) is unchanged. */
export function withReporter(script, root = repoRoot) {
  if (!NODE_TEST.test(script)) return script;
  const args = reporterArgs(root).map((a) => `'${a.replaceAll("'", "'\\''")}'`);
  return script.replace(NODE_TEST, `node --test ${args.join(" ")}`);
}

/** Whether the unit runs under `node --test`, and so must print MARK. */
export function reportsEveryFile(unit) {
  return !unit.workspace || NODE_TEST.test(unit.script);
}

/** How a unit runs: its workspace's `test` script under `sh -c` in the
 *  workspace's directory, with the workspace's and the root's
 *  `node_modules/.bin` first on PATH (what `npm test` would do), or the
 *  root's own files for `root`. Never through npm: npm sets
 *  process.title, which on macOS can abort the process before it prints
 *  a byte (see the header). */
export function unitCommand(
  unit,
  root = repoRoot,
  basePath = process.env.PATH,
) {
  if (!unit.workspace)
    return {
      cmd: process.execPath,
      args: [
        "--test",
        ...reporterArgs(root),
        "docs/*.test.mjs",
        "acceptance/**/*.test.mjs",
      ],
      cwd: root,
      env: {},
    };
  const bins = [
    path.join(unit.dir, "node_modules", ".bin"),
    path.join(root, "node_modules", ".bin"),
  ];
  return {
    cmd: "sh",
    args: ["-c", withReporter(unit.script, root)],
    cwd: unit.dir,
    env: { PATH: [...bins, basePath].filter(Boolean).join(path.delimiter) },
  };
}

export function runUnit(unit, env = {}) {
  const { cmd, args, cwd, env: own } = unitCommand(unit);
  const started = Date.now();
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const finish = (exit, signal, note) => {
      if (settled) return;
      settled = true;
      if (note) chunks.push(Buffer.from(note));
      const output = Buffer.concat(chunks).toString("utf8");
      // A node test unit that exited 0 without the file check's line
      // ran without it (#1052): not a pass, whatever node counted.
      const unchecked =
        exit === 0 &&
        !signal &&
        reportsEveryFile(unit) &&
        !output.includes(MARK);
      resolve({
        ...unit,
        ok: exit === 0 && !signal && !unchecked,
        exit,
        signal: signal ?? null,
        unchecked,
        seconds: (Date.now() - started) / 1000,
        output,
      });
    };
    const childEnv = {
      ...process.env,
      ...env,
      ...own,
      FORCE_COLOR: process.env.FORCE_COLOR ?? "0",
    };
    // A unit is a top-level node --test run even when this runs inside
    // one (the runner's own tests): inherited, this makes node --test
    // a child that writes serialized results and skips its reporters.
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    // A unit that cannot start (EAGAIN under a process limit, a missing
    // shell) is that unit's failure, said in its output, not the run's
    // crash.
    child.on("error", (err) =>
      finish(
        err.code ?? "error",
        null,
        `test: could not start ${cmd}: ${err.message}\n`,
      ),
    );
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/** How a unit ended, in words: "exit 1", "killed by SIGABRT". */
export function describeExit(r) {
  if (r.signal) return `killed by ${r.signal}`;
  if (r.unchecked)
    return `exit 0, but no "${MARK}" line: the per-file test count never ran`;
  return typeof r.exit === "number" ? `exit ${r.exit}` : `${r.exit}`;
}

/** One unit's block of the run's output. A failure always names how the
 *  unit ended, says so when it printed nothing, and for a signal on
 *  macOS points at the crash report the system wrote. */
export function formatReport(
  r,
  { actions = inActions, platform = process.platform } = {},
) {
  const ended = r.ok ? "" : `, ${describeExit(r)}`;
  const head = `${r.ok ? "ok  " : "FAIL"} ${r.name} (${r.seconds.toFixed(1)} s${ended})`;
  if (actions && r.ok) return `::group::${head}\n${r.output}\n::endgroup::\n`;
  let out = `\n──── ${head} ────\n${r.output}\n`;
  if (!r.ok) {
    const silent = r.output.trim() === "";
    const why = [
      `test: ${r.name} failed: ${describeExit(r)}${silent ? ", and it printed nothing" : ""}.`,
    ];
    if (r.signal && platform === "darwin")
      why.push(
        `test: a process killed by a signal on macOS leaves a crash report in ~/Library/Logs/DiagnosticReports (node-<date>-<time>.ips); its faulting thread says where it died.`,
      );
    out += `${why.join("\n")}\n`;
    if (actions)
      out += `::error title=test ${r.name}::${r.name} failed (${describeExit(r)})\n`;
  }
  return out;
}

function report(r) {
  process.stdout.write(formatReport(r));
}

async function pool(list, jobs, env) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const unit = list[next++];
      const r = await runUnit(unit, env);
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
        .slice(2, 14)
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
    `test: ${where}${chosen.length} units, ${opts.jobs} at a time, at most ${opts.dbSlots} scratch databases: ${chosen.map((u) => u.name).join(" ")}`,
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

  const slots = mkdtempSync(path.join(os.tmpdir(), "elixir-mcp-db-slots-"));
  let results;
  try {
    results = await pool(chosen, opts.jobs, {
      ELIXIR_TEST_DB_SLOTS_DIR: slots,
      ELIXIR_TEST_DB_SLOTS: String(opts.dbSlots),
      // The handlers' pools (web-api, mcp, collector), as the smallest
      // production function runs: a test file's requests queue for two
      // connections rather than open four.
      DB_POOL_MAX: process.env.DB_POOL_MAX ?? "2",
    });
  } finally {
    rmSync(slots, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  const wall = (Date.now() - started) / 1000;
  const sum = results.reduce((s, r) => s + r.seconds, 0);
  console.log(
    `\n${where}${results.length} units in ${wall.toFixed(1)} s (${sum.toFixed(1)} s of unit time, ${opts.jobs} at a time)`,
  );
  for (const r of [...results].sort((a, b) => b.seconds - a.seconds))
    console.log(
      `  ${r.ok ? "ok  " : "FAIL"} ${r.seconds.toFixed(1).padStart(6)} s  ${r.name}${r.ok ? "" : ` (${describeExit(r)})`}`,
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
