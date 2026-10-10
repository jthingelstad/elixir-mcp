import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.26.0",
  date: "2026-09-23",
  summary: md(
    "The game family, after the Elixir Gym's first run on it (feedback #125-#127).",
    list(
      "`game_events` selects the events reads made inside the window's own instants, not the UTC dates around them (#125). A window holding no read returns nothing, and `timezone` now matters. `game_days_read` lists the game days a read covered, a note names the game days in the window nothing read, and `running_on_latest_day` is described (#126).",
      "The events read is anchored to the 10:00Z board-day like the daily leaderboards, instead of 24 hours after the last one (#126). It had drifted about 26h50m apart and skipped a game day about every ten days (2026-09-12, 2026-09-22).",
      "`game_clock({at: 'YYYY-MM-DD'})` means that game day: its start, 10:00Z. Before, it meant 00:00Z, which is still the day before on the game's grid, and a note now says which instant was used (#127).",
    ),
    "Additive: game_days_read; corrected: game_events' window, game_clock's date-only at.",
  ),
} satisfies ChangelogEntry;
