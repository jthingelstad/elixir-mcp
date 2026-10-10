import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.1",
  date: "2026-09-24",
  summary: md(
    "The game tools, after the Elixir Gym's third run on them (feedback #219-#222).",
    list(
      "`game_clock` with a date-only `at` adds its note beside the clock's standing notes; it had replaced them, dropping the race-close caveat and the Colosseum-practice note (#219).",
      "`game_events` names the season rolls inside its whole window, a future one included, where it had cut the window at now and missed the 10-05 roll; a window that starts after now says it is empty by construction (#220).",
      "`game_events` refuses an inverted window (`from` after `to`), as the battle tools do; it had answered 0 events with no word (#221).",
    ),
    "Additive; one refusal for input that was never meaningful.",
  ),
} satisfies ChangelogEntry;
