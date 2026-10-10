import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.1",
  date: "2026-09-23",
  summary: md(
    "The war tools, after the Elixir Gym's second run on them (feedback #179-#181).",
    list(
      "game_clock no longer says war_current carries a race's close: war_history's `closed_at` is each past week's real close, and nothing serves today's before it happens. war_current says a race closes before the 10:00Z grid, and that `observed_offset_minutes` is when the recorder saw a period open, never the close. war_history describes `finished` as the API's close where the API gave it (#179).",
      "war_history and war_rivals say a war day's fame (`progress_earned`) is paid for the clan's placement that day on points (observed 3,000 / 1,800 / 1,000 for the first three), not for the points, so fame and `mean_fame` measure placements, not effort (#180).",
      "The battles docs' war section says `clan_war_trophies` is the figure going into the race (#181).",
    ),
    "Notes and docs; no value changes.",
  ),
} satisfies ChangelogEntry;
