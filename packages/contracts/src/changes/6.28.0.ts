import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.28.0",
  date: "2026-09-23",
  summary: md(
    "The ranking tools, after the Elixir Gym's first run on them (feedback #136-#138).",
    list(
      "`rankings_clan_ladder` says when places on the page share a score: the game lists a tie in its own order, so rank inside it, and rank against `previous_rank`, is not a standing (#136). The global clan board had 360 clans tied at the 140,000 ceiling, ranked 1 to 360.",
      "Mode boards stop carrying the Path of Legends notes, and say that their rating is the event's own. `snapshot.standings_changed_at` on a mode board, and on each row of the `location: \"list\"` catalog, says when rank or rating last moved. A snapshot is also written when only a clan changes, so a closed event's `observed_at` read as today. A note says when a board's standings have not moved in two days (#137).",
      "The notes that point at per-battle rank and rating name the fields `battles_query` serves: `global_rank`, `starting_trophies`, `trophy_change` (#138).",
      "`players_profile` points lifetime donations at the `players_timeline` `total_donations` series; the note named a `lifetime` field the profile never carried.",
    ),
    "Additive fields and notes; no value changes.",
  ),
} satisfies ChangelogEntry;
