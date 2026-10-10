import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.2.2",
  date: "2026-10-05",
  summary:
    "When the recorder observes a newer river race while its immediate predecessor has no recorded closure, the preceding race log becomes due for one catch-up instead of waiting for the daily poll. The normal rate budget, live reserve and bounded retries still apply. Closure and award inputs remain recorded API facts, never inferred from the calendar. Response shapes and JSON API 3.0.0 are unchanged.",
} satisfies ChangelogEntry;
