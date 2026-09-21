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
 * live-polled week ever equalled it; a 7-day corpus meta read timed out
 * only past 800k participant rows. This suite reads the deployed door
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
 *   gym        - the Elixir Gym's filed repros (#70-#82) with their
 *                acceptance criteria, its Pass 2 automated
 *
 * Usage: node acceptance/run.mjs [--only <substring>] [--json]
 * Needs acceptance/.env (ELIXIR_MCP_URL, ELIXIR_MCP_TOKEN); the deploy
 * runs it after the smoke gate and fails on a red case. It never writes,
 * never passes live: true, and its token cannot: cr:read only.
 */

import { loadEnv, makeDoor } from "./door.mjs";
import { contracts } from "./checks/contracts.mjs";
import { identities } from "./checks/identities.mjs";
import { budgets } from "./checks/budgets.mjs";
import { gym } from "./checks/gym.mjs";
import { catalogue } from "./checks/catalogue.mjs";
import { loadCatalogue } from "./catalogue.mjs";
import { writeShape, loadShape } from "./shapes.mjs";

export const SUITES = { contracts, identities, budgets, gym, catalogue };
/** Suites whose cases are independent run a few at a time; the hand-
 *  written suites share reads in order and stay sequential. */
/** One at a time everywhere: the budget rule times each call, and three
 *  heavy reads on the micro inflate each other (cards_synergy read 8-11 s
 *  under a pool of three, 4 s alone). */
const CONCURRENCY = { catalogue: 1 };

/** Run every case against a door. Cases in a suite run in order and
 *  share `ctx.cache` (a read one case made is reused by the next, so the
 *  suite spends ~40 calls, not 100). Returns the report; prints unless
 *  `quiet`. */
export async function runSuite(
  door,
  { only = null, quiet = false, tools: given = null } = {},
) {
  const tools = given ?? (await door.toolsList());
  const ctx = {
    call: door.call,
    tools: new Map(tools.map((t) => [t.name, t])),
    cache: new Map(),
    /** A read, cached by tool + args for the run. */
    read: async (tool, args = {}) => {
      const key = `${tool}:${JSON.stringify(args)}`;
      if (!ctx.cache.has(key)) ctx.cache.set(key, await door.call(tool, args));
      return ctx.cache.get(key);
    },
  };
  const report = { cases: [], failures: 0, calls: 0 };
  const log = (line) => {
    if (!quiet) console.log(line);
  };
  const runOne = async (suite, c) => {
    const id = `${suite}/${c.id}`;
    const started = performance.now();
    let error = null;
    let ms = null;
    try {
      const out = await c.run(ctx);
      ms = out?.ms ?? null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const wall = Math.round(performance.now() - started);
    report.cases.push({ id, ok: !error, ms: ms ?? wall, error });
    if (error) report.failures += 1;
    log(
      `${error ? "FAIL" : "ok  "} ${id}${ms !== null ? ` (${ms} ms)` : ""}${error ? `\n     ${error}` : ""}`,
    );
  };
  for (const [suite, cases] of Object.entries(SUITES)) {
    const picked = cases.filter(
      (c) => !only || `${suite}/${c.id}`.includes(only),
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
  const json = args.includes("--json");
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
  const report = await runSuite(door, { only, quiet: json });
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
          body: report.ctx.cache.get(`${tool}:${JSON.stringify(set.args)}`)
            ?.body,
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
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `\n${report.cases.length} cases, ${report.failures} failed, ${report.calls} distinct calls`,
    );
    console.log(`slowest: ${slow.map((c) => `${c.id} ${c.ms} ms`).join(", ")}`);
    console.log(
      `shape provenance: ${status.recorded.length} tools on a recorded baseline (write their outputSchema)${status.recorded.length ? `: ${status.recorded.join(", ")}` : ""}; ${status.unpinned.length} with neither${status.unpinned.length ? `: ${status.unpinned.join(", ")}` : ""}`,
    );
  }
  process.exit(report.failures ? 1 : 0);
}
