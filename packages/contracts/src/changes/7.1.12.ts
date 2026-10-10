import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.12",
  date: "2026-09-24",
  summary: md(
    "The game tools after the Elixir Gym's fourth run on them (feedback #296-#298), and a clan's own place on the clan ladder (#294).",
    list(
      "`game_events` says when the window touches a game day whose events read fell outside it: a Chicago Monday is mostly game day 09-21, read at 09-22T09:02Z, and that day's events were missing with no word (#296).",
      "`game_events` takes `season`, as every windowed tool does (#297).",
      "`game_clock` carries `is_colosseum`, `weeks_in_season` and `colosseum_starts_at`: a season holds 4 or 5 weeks, so the week number alone did not say Colosseum (#298).",
      "`rankings_clan_ladder` serves `snapshot.floor_score` and `our_clan`, the caller's clan's rank or, off the board, its score and gap to the last place. `clans_roster` serves `clan_score`, `clan_war_trophies` and `scores_observed_at`; the ladder note no longer calls clan score a sum (#294).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
