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

export const SUITES = { contracts, identities, budgets, gym };

/** Run every case against a door. Cases in a suite run in order and
 *  share `ctx.cache` (a read one case made is reused by the next, so the
 *  suite spends ~40 calls, not 100). Returns the report; prints unless
 *  `quiet`. */
export async function runSuite(door, { only = null, quiet = false } = {}) {
  const tools = await door.toolsList();
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
  for (const [suite, cases] of Object.entries(SUITES)) {
    for (const c of cases) {
      const id = `${suite}/${c.id}`;
      if (only && !id.includes(only)) continue;
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
    }
  }
  report.calls = ctx.cache.size;
  return report;
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
  const door = makeDoor({
    url: env.ELIXIR_MCP_URL,
    token: env.ELIXIR_MCP_TOKEN,
  });
  const report = await runSuite(door, { only, quiet: json });
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
  }
  process.exit(report.failures ? 1 : 0);
}
