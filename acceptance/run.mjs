#!/usr/bin/env node
/**
 * The acceptance suite: the deployed product against the real record,
 * read-only, as a release gate (Jamie, 2026-09-21: "we run the risk of
 * regression without it").
 *
 * The unit tests pin logic over fixtures; the smoke gate pins the door
 * at the HTTP level; the Gym explores weekly. What none of them pin is
 * the live data shape at the live scale - `finished_early` was computed
 * as fame === 10000 and passed its fixture test for a fortnight while no
 * live-polled week ever equalled it. This suite reads the deployed door
 * with a read-only agent token and asserts INVARIANTS, never values
 * that change daily:
 *
 *   contracts  - every field a notes[] sentence names exists on the
 *                response it rides (the finished_early class)
 *   identities - one number two tools serve agrees; a count's
 *                denominator is on the row; a flag and its detail agree
 *   budgets    - the known-heavy calls answer inside a ceiling well
 *                under the 18 s query budget, so creep is caught before
 *                it is a timeout
 *
 * The Gym's regression pass (the `gym` suite: the Elixir Gym's filed
 * repros with their acceptance criteria, its Pass 2 automated) is NOT
 * part of the gate (Jamie, 2026-11-13: it "should only be used for
 * extensive testing in gym sessions"). It is five sixths of the cases
 * and of the reads; a Gym session asks for it with --gym.
 *
 * Usage: node acceptance/run.mjs [--gym] [--only <substring>] [--family <family>] [--json] [--no-pace]
 *   --gym runs the Gym's regression pass INSTEAD of the gate, in a Gym
 *   session only; --family and --only narrow it the same way.
 *   --family battles runs only the cases that read a battles_* tool: the
 *   per-family deploy gate (deploy.mjs --acceptance=<family>).
 *   Paced by default (PACE below); --no-pace for a local server only.
 * Needs acceptance/.env (ELIXIR_MCP_URL, ELIXIR_MCP_TOKEN); the deploy
 * runs it after the smoke gate and fails on a red case. It never writes,
 * never passes live: true, and its token cannot: cr:read only.
 */

import { readFileSync } from "node:fs";
import { loadEnv, makeDoor } from "./door.mjs";
import { contracts } from "./checks/contracts.mjs";
import { identities } from "./checks/identities.mjs";
import { budgets } from "./checks/budgets.mjs";
import { gym } from "./checks/gym.mjs";
import { catalogue } from "./checks/catalogue.mjs";
import { ground } from "./checks/ground.mjs";
import { loadCatalogue } from "./catalogue.mjs";
import { writeShape, loadShape } from "./shapes.mjs";
import {
  redact,
  reportSubjects,
  seedSubjects,
  substitute,
} from "./subjects.mjs";

export const SUITES = {
  contracts,
  identities,
  budgets,
  gym,
  catalogue,
  ground,
};
/** The suites the gate leaves out: run only when asked for by name
 *  (--gym, or an --only that starts with the suite's name). */
export const GYM_SUITES = new Set(["gym"]);
/** Failures filed for a decision rather than a fix, each with a reason
 *  and an expiry: reported as KNOWN and not counted until the date. */
const KNOWN = new Map(
  JSON.parse(
    readFileSync(new URL("./known.json", import.meta.url), "utf8"),
  ).map((k) => [k.case, k]),
);
/** One at a time everywhere: the budget rule times each call, and three
 *  heavy reads on the micro inflate each other. A test pins it at 1. */
export const CONCURRENCY = { catalogue: 1 };

/**
 * The pace (2026-11-13): after each call that reaches the door, the run
 * rests `ratio` times as long as that call took, between `minRestMs` and
 * `maxRestMs`, before its next one. The database is a db.t4g.micro whose
 * EBS bandwidth bursts from a bucket that refills only a few points an
 * hour; back-to-back runs at full speed (about 7 MB/s of reads, peaks of
 * 15 to 19) drained it to 0 on 2026-11-12/13 and it dropped connections.
 * Resting twice each call's time spreads the same reads over about three
 * times the wall clock, so the bucket refills during the run. A rest is
 * taken before the next call, never after the last; a cached read never
 * reaches the door and never rests. `--no-pace` for a local server.
 */
export const PACE = { ratio: 2, minRestMs: 250, maxRestMs: 10_000 };

/** How long to rest after a call that took `ms`. */
export function restAfter(ms, pace = PACE) {
  if (!pace) return 0;
  return Math.min(
    pace.maxRestMs,
    Math.max(pace.minRestMs, Math.round(Math.max(0, ms) * pace.ratio)),
  );
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The door with the pace applied to `call` (tools/list is one call at
 * the start and is left alone). Returns the door itself when `pace` is
 * null. `sleep` and `now` are injected so the tests run on a fake clock.
 * The runner is one call at a time, so one rest owed at a time.
 */
export function pacedDoor(
  door,
  { pace = PACE, sleep = sleepFor, now = () => performance.now() } = {},
) {
  if (!pace) return door;
  let owed = 0;
  const stats = { calls: 0, restedMs: 0, callMs: 0 };
  return {
    ...door,
    stats,
    async call(name, args) {
      if (owed > 0) {
        await sleep(owed);
        stats.restedMs += owed;
      }
      const started = now();
      try {
        return await door.call(name, args);
      } finally {
        const took = now() - started;
        stats.calls += 1;
        stats.callMs += took;
        owed = restAfter(took, pace);
      }
    },
  };
}

/** Run every case against a door. Cases in a suite run in order and
 *  share `ctx.cache` (a read one case made is reused by the next, so the
 *  suite spends ~40 calls, not 100). Returns the report; prints unless
 *  `quiet`. */
export async function runSuite(
  door,
  {
    only = null,
    family = null,
    // The Gym's regression pass instead of the gate (GYM_SUITES).
    gym: gymPass = false,
    quiet = false,
    tools: given = null,
    recordedFixtures = false,
    // A replay seeds what each placeholder stood for (subjects.mjs).
    subjects = null,
    // The CLI passes PACE (live runs); tests and bite replays run unpaced.
    pace = null,
    sleep = undefined,
    now = undefined,
  } = {},
) {
  const tools = given ?? (await door.toolsList());
  door = pacedDoor(door, { pace, sleep, now });
  const ctx = {
    // Bite replays already supply the named fixture; live runs never set this.
    recordedFixtures,
    call: door.call,
    tools: new Map(tools.map((t) => [t.name, t])),
    cache: new Map(),
    /** A read, cached by tool + args for the run. */
    read: async (tool, args = {}, { fresh = false } = {}) => {
      const key = `${tool}:${JSON.stringify(args)}`;
      if (fresh || !ctx.cache.has(key))
        ctx.cache.set(key, await door.call(tool, args));
      return ctx.cache.get(key);
    },
  };
  if (subjects) seedSubjects(ctx, subjects);
  const report = { cases: [], failures: 0, calls: 0 };
  const log = (line) => {
    if (!quiet) console.log(line);
  };
  const runOne = async (suite, c) => {
    const id = `${suite}/${c.id}`;
    const started = performance.now();
    let error = null;
    let ms = null;
    let skip = null;
    try {
      const out = await c.run(ctx);
      ms = out?.ms ?? null;
      skip = out?.skip ?? null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      // A resolved player's tag (subjects.mjs) never reaches the report:
      // a failure that echoes one shows the placeholder instead.
      if (ctx.subjects?.resolved?.size)
        error = redact(error, ctx.subjects.resolved);
    }
    const wall = Math.round(performance.now() - started);
    // A known failure (known.json: a reason and an expiry, filed for a
    // decision) is reported, not counted - until its date passes.
    const known = error ? KNOWN.get(id) : null;
    const expired = known && Date.parse(known.until) < Date.now();
    const counts = Boolean(error) && (!known || expired);
    report.cases.push({
      id,
      ok: !error,
      known: known && !expired ? known.reason : undefined,
      ms: ms ?? wall,
      error,
    });
    if (counts) report.failures += 1;
    if (skip) report.skipped = (report.skipped ?? 0) + 1;
    // A failure has no `ms` of its own (it threw), so it shows its wall
    // time: a FAIL at the door's deadline reads as the timeout it was.
    const shown = ms ?? (error ? wall : null);
    log(
      `${skip ? "SKIP" : !error ? "ok  " : counts ? "FAIL" : "KNOWN"} ${id}${skip ? ` - ${skip}` : ""}${shown !== null ? ` (${shown} ms)` : ""}${error ? `\n     ${error}` : ""}${known && !expired ? `\n     known until ${known.until}: ${known.reason}` : ""}${expired ? `\n     the known-failure entry expired ${known.until}` : ""}`,
    );
  };
  // A per-family gate (2026-09-23): the cases that read a tool of that
  // family - a case's own `tools`, else the tool names in its id - so a
  // family's deploy stops paying for every other family's heavy reads.
  const caseTools = (c) =>
    c.tools?.length
      ? c.tools
      : [...ctx.tools.keys()].filter((t) => c.id.includes(t));
  // A #docs case checks a shared docs section against what EVERY tool
  // served this run, so it belongs to the whole suite, not a family's.
  const inFamily = (c) =>
    !family ||
    (!c.id.endsWith("#docs") &&
      // A comma list gates several families in one pass (game,war).
      caseTools(c).some((t) =>
        family.split(",").some((f) => t.startsWith(`${f.trim()}_`)),
      ));
  // The gate or the Gym's pass, never both in one run. An `only` that
  // names a Gym case (a bite replay: "gym/304.1") is asking for it.
  const wantsGym =
    gymPass || [...GYM_SUITES].some((name) => only?.startsWith(`${name}/`));
  for (const [suite, cases] of Object.entries(SUITES)) {
    if (GYM_SUITES.has(suite) !== wantsGym) continue;
    const picked = cases.filter(
      (c) => (!only || `${suite}/${c.id}`.includes(only)) && inFamily(c),
    );
    const width = CONCURRENCY[suite] ?? 1;
    // Phase 2 cases read what phase 1 left in the cache (a tool's docs
    // case reads the union of its sets' responses).
    for (const phase of [1, 2]) {
      const queue = picked.filter((c) => (c.phase ?? 1) === phase);
      const workers = Array.from(
        { length: Math.min(width, queue.length) },
        async () => {
          while (queue.length) await runOne(suite, queue.shift());
        },
      );
      await Promise.all(workers);
    }
  }
  report.calls = ctx.cache.size;
  if (door.stats)
    report.pace = {
      calls: door.stats.calls,
      call_seconds: Math.round(door.stats.callMs / 1000),
      rest_seconds: Math.round(door.stats.restedMs / 1000),
    };
  report.ctx = ctx;
  return report;
}

/** Tools the catalogue reads that publish no outputSchema: those with a
 *  recorded baseline (a to-do: write the schema) and those with neither
 *  (a gap: nothing pins their shape). */
export function baselineStatus(tools) {
  let catalogueTools = {};
  try {
    catalogueTools = loadCatalogue().tools;
  } catch {
    return { recorded: [], unpinned: [] };
  }
  const recorded = [];
  const unpinned = [];
  for (const tool of Object.keys(catalogueTools)) {
    if (tools.get(tool)?.outputSchema) continue;
    (loadShape(tool) ? recorded : unpinned).push(tool);
  }
  return { recorded, unpinned };
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const env = loadEnv();
  if (!env) {
    console.error(
      "acceptance: no acceptance/.env (ELIXIR_MCP_URL, ELIXIR_MCP_TOKEN); see acceptance/README.md",
    );
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const only = args.includes("--only")
    ? args[args.indexOf("--only") + 1]
    : null;
  const family = args.includes("--family")
    ? args[args.indexOf("--family") + 1]
    : null;
  const json = args.includes("--json");
  const gymPass = args.includes("--gym");
  const pace = args.includes("--no-pace") ? null : PACE;
  const updateShapes = args.includes("--update-shapes");
  const reason = args.includes("--reason")
    ? args[args.indexOf("--reason") + 1]
    : null;
  if (updateShapes && !reason) {
    console.error(
      '--update-shapes needs --reason "why the baseline moves": it is a reviewed change',
    );
    process.exit(2);
  }
  const door = makeDoor({
    url: env.ELIXIR_MCP_URL,
    token: env.ELIXIR_MCP_TOKEN,
  });
  if (!json)
    console.log(
      pace
        ? `acceptance: paced (rest ${pace.ratio}x each call, ${pace.minRestMs}-${pace.maxRestMs} ms) so the database's burst balance refills during the run`
        : "acceptance: UNPACED (--no-pace): never against production",
    );
  if (!json && gymPass)
    console.log(
      "acceptance: the Gym's regression pass (--gym), not the deploy gate",
    );
  const report = await runSuite(door, {
    only,
    family,
    gym: gymPass,
    quiet: json,
    pace,
  });
  const status = baselineStatus(report.ctx.tools);
  if (updateShapes) {
    const contract =
      [...report.ctx.cache.values()].find((r) => r.body?.meta?.contract_version)
        ?.body.meta.contract_version ?? null;
    const written = [];
    for (const [tool, entry] of Object.entries(loadCatalogue().tools)) {
      if (report.ctx.tools.get(tool)?.outputSchema) continue;
      const sets = entry.sets
        .map((set) => ({
          args: set.args,
          body: report.ctx.cache.get(
            `${tool}:${JSON.stringify(substitute(set.args, report.ctx.subjects?.resolved ?? new Map()))}`,
          )?.body,
        }))
        .filter((set) => set.body && !set.body.error);
      if (sets.length)
        written.push(writeShape(tool, sets, { reason, contract }));
    }
    if (!json)
      console.log(
        `shapes written: ${written.map((w) => `${w.tool} (${w.was})`).join(", ")}`,
      );
  }
  const slow = [...report.cases]
    .filter((c) => c.ok && c.ms)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);
  // Masked here; in full only in acceptance/subjects.log (ignored by git).
  const subjects = reportSubjects(report.ctx);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    if (subjects.length)
      console.log(
        `\nsubjects (masked; full tags in acceptance/subjects.log): ${subjects.join(", ")}`,
      );
    console.log(
      `\n${report.cases.length} cases, ${report.failures} failed${report.skipped ? `, ${report.skipped} skipped` : ""}, ${report.calls} distinct calls`,
    );
    if (report.pace)
      console.log(
        `pace: ${report.pace.calls} door calls, ${report.pace.call_seconds} s calling, ${report.pace.rest_seconds} s resting`,
      );
    console.log(`slowest: ${slow.map((c) => `${c.id} ${c.ms} ms`).join(", ")}`);
    console.log(
      `shape provenance: ${status.recorded.length} tools on a recorded baseline (write their outputSchema)${status.recorded.length ? `: ${status.recorded.join(", ")}` : ""}; ${status.unpinned.length} with neither${status.unpinned.length ? `: ${status.unpinned.join(", ")}` : ""}`,
    );
  }
  process.exit(report.failures ? 1 : 0);
}
