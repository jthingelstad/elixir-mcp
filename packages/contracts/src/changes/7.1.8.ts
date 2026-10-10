import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.8",
  date: "2026-09-24",
  summary: md(
    "The player tools after the Elixir Gym's fourth run on them (feedback #275-#278).",
    list(
      "`season_trophies`, `season_best_trophies` and `players_profile.snapshot.league_statistics` are described as what they are: the API's legacy leagueStatistics, which mirrors Trophy Road and holds a frozen best, not the seasonal Trophy Road; a note says so when the metrics are asked for and points at `progress_key` (#275).",
      "`players_profile` serves `snapshot.progress`, each side-mode bucket's latest reading (Merge Tactics, 2v2 League, the seasonal Trophy Road), and the recording docs describe the progress readers that shipped (#276).",
      "Every place that described `kind: pre_reset` as the week's donation total calls it a lower bound, as the notes do (#277).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
