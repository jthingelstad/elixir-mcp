import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.34.0",
  date: "2026-09-23",
  summary: md(
    "elixir_timeline, after the Elixir Gym's second run on the elixir family (feedback #162-#167).",
    list(
      "A capped page is cut on `observed_at`, the instant that selects an item into a window, and `next_cursor` sits 1 ms before the first item left out. Continuing from it loses nothing at the cut and repeats nothing. Every item, sessions included, carries the instant the record learned it as `observed_at`, and the back-dating note quotes this page's longest lag (#162).",
      "`days_since_poll` counts from the last battle-log read at or before the window's end, so a past window no longer reads null because a later poll exists (#163).",
      "Every `session_standout` is an item. Five were served and the rest dropped with `has_more` false (#164).",
      "The clan summary's donations read the game week the window ends in: a window ending exactly on the Monday 10:00Z boundary is the week that just closed, not an empty new one (#165).",
      "The clan entry's `war` is the calendar's week at the window's end. Its race facts are that week's record, or null when none is recorded, never the current week's under a past day's label (#166).",
      "elixir_updates, elixir_examples and the elixir_docs index carry `docs` (#167). clans_participation's donations note states the highest-value rule of 6.33.0.",
    ),
    "Corrected values: paging, days_since_poll on past windows, standout items, the week of the clan summary's donations and war.",
  ),
} satisfies ChangelogEntry;
