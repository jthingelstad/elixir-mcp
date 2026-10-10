import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.19.3",
  date: "2026-09-23",
  summary: md(
    "Faster level gaps and trends, and three more tools on the analytical budget. Wire shapes are unchanged.",
    list(
      "Every level gap (`mean_level_gap` on `battles_cards`, `battles_decks`, the two meta tools, `players_summary` and `clans_standings`) now reads the opponent's deck level from the battle row, not from a lookup per battle. A clan's season `battles_meta_cards` went from 8.2 s to 2.3 s, and `battles_meta_decks` from 6.7 s to 0.4 s. The values are the same.",
      "`battles_trends` no longer joins every battle back to the battle table for fields the participant row already carries.",
      "`battles_trends`, `cards_card` and `cards_synergy` join the analytical reads. They get the larger sort memory, and they return a structured `query_timeout` with a request id at the 18-second budget instead of racing the function's deadline. `war_history` was already one of these reads; the limits page now lists it.",
    ),
    "Performance; the only behaviour change is which error an over-budget read returns.",
  ),
} satisfies ChangelogEntry;
