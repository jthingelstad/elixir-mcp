import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "15.5.0",
  date: "2026-11-23",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md(
    "One win rate everywhere: every win_rate is decided wins over decided_battles (head-to-head wins and losses), and every row that carries a win_rate now carries decided_battles beside it. Boat battles and draws stay in battles, wins and losses and are in no rate, as battles_performance's window and the docs already said. Rates move only where a row holds boat battles.",
    list(
      'battles_performance: group_by "game_mode" and "week" rows add decided_battles and their win_rate is over it; a boat battle row keeps its wins and losses with win_rate null.',
      "battles_decks, battles_cards: rows add decided_battles; win_rate is over it and null when a row holds no decided battle. battles_decks sort win_rate follows.",
      "players_summary: last_30_days, top_deck and best_deck add decided_battles; win_rate is over it, and best_deck's floor counts decided battles.",
      "clans_standings: members add decided_battles; win_rate is over it and min_battles is a floor on decided battles, so boat wins no longer lift a member over it.",
    ),
    "Additive, with win_rate corrected to its documented definition.",
  ),
} satisfies ChangelogEntry;
