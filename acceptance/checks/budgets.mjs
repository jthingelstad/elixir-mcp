/** budgets: the known-heavy calls answer inside a ceiling well under the
 *  18 s analytical budget, so creep is caught before it is a timeout
 *  (feedback #77-#79: a 7-day corpus meta read had crossed it and nobody
 *  knew until an agent filed it). Ceilings are ~1.5x the time measured
 *  live on 2026-09-21 (decks 5 s, cards 8-12 s); a run prints every
 *  duration, so a trend is visible before a ceiling is. */

import { answered, ok } from "../lib.mjs";

function budget(id, tool, args, ceilingMs) {
  return {
    id,
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
  budget(
    "meta-decks-corpus-week",
    "battles_meta_decks",
    { segment: "corpus", days: 7, limit: 5, verbosity: "compact" },
    9_000,
  ),
  budget(
    "meta-cards-corpus-week",
    "battles_meta_cards",
    { segment: "corpus", days: 7, limit: 5, verbosity: "compact" },
    15_000,
  ),
  budget(
    "meta-decks-corpus-season",
    "battles_meta_decks",
    { segment: "corpus", limit: 5 },
    6_000,
  ),
  budget(
    "meta-cards-corpus-season",
    "battles_meta_cards",
    { segment: "corpus", limit: 5 },
    6_000,
  ),
  budget(
    "meta-decks-clan-season",
    "battles_meta_decks",
    { segment: "mine", limit: 5 },
    10_000,
  ),
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
