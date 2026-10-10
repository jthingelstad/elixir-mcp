import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.27.0",
  date: "2026-09-23",
  summary: md(
    "The player tools, after the Elixir Gym's first run on them (feedback #129-#134).",
    list(
      "`players_search` ranks an agent's own clan's members as clanmates and a whole-name match before a partial one, and serves `total_matches` and `truncated` (#129). Before, it ranked clanmates only through a person's claimed players, so an agent never saw its clan first.",
      "Deck-level `modes` on `players_summary` and `battles_decks` are event-aware: event battles are `event`, not `casual`. `top_deck` and `best_deck` come only from decks the player chose, and `net_trophies` is Trophy Road's alone (#130).",
      "`war_day_wins` and `clan_cards_collected` are described as what they are: frozen counters of the retired Clan Wars format, not lifetime war wins or donations (#131).",
      "`top_deck` and `best_deck` carry `trophy_range` and `last_played_at`, and a note says when their ladder ranges do not overlap (#132).",
      "`players_collection` `fielded` carries `recent_mean_level` (the last ten decided battles) beside the 30-day mean, with a note when they differ by a level. It also echoes the window behind it (#133, #134).",
      "`players_summary` echoes `season` and `crosses` with the shared note, and `players_timeline` takes `season` (#134).",
    ),
    "Additive fields; corrected values (deck modes, net_trophies, clanmate ranking).",
  ),
} satisfies ChangelogEntry;
