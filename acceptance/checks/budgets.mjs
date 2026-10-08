/** budgets: the known-heavy calls answer inside a ceiling well under the
 *  18 s analytical budget, so creep is caught before it is a timeout. A
 *  run prints every duration, so a trend is visible before a ceiling is. */

import { answered, ok } from "../lib.mjs";

function budget(id, tool, args, ceilingMs) {
  return {
    id,
    tools: [tool],
    run: async (ctx) => {
      const r = await ctx.read(tool, args);
      answered(r, `${tool} ${JSON.stringify(args)}`);
      ok(
        r.ms <= ceilingMs,
        `${tool} ${JSON.stringify(args)} took ${r.ms} ms, ceiling ${ceilingMs}`,
      );
      return { ms: r.ms };
    },
  };
}

export const budgets = [
  budget("clans_participation", "clans_participation", { weeks: 2 }, 8_000),
  budget("war_current", "war_current", {}, 6_000),
  budget(
    "players_summary",
    "players_summary",
    { player_tag: "#20JJJ2CCRU" },
    6_000,
  ),
  budget("clans_standings", "clans_standings", { days: 7 }, 8_000),
];
