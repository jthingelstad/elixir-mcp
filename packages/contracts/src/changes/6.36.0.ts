import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.0",
  date: "2026-09-23",
  summary: md(
    "The ranking tools, after the Elixir Gym's second run on them (feedback #174-#177).",
    list(
      "`rankings_clans` on a mode board says its rating is the event's own, drops the Path of Legends note and says when a board has gone still. `rankings_timeline` on a mode board says a point is written when only names or clans change, so a closed event keeps writing points (#174).",
      "When a board's ranks and ratings have not moved since its first snapshot, the note says recording began then: when they last moved before that is unknown, and it no longer says names and clans refreshed on a board with one snapshot (#175).",
      '`board: "trophy"` refuses with the reason: the API has served the Trophy Road leaderboard empty for recent seasons. It no longer reads like an unknown location (#176).',
      "`rankings_timeline` takes `season`, as every windowed tool does (#177).",
    ),
    "Notes, a refusal and a new argument; no value changes.",
  ),
} satisfies ChangelogEntry;
