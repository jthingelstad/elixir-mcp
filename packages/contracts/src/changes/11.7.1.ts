import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.7.1",
  date: "2026-10-10",
  summary: md(
    "Two reads that were slower than they should be.",
    list(
      "elixir_timeline: the skip_empty check reads quiet_crossed from each subject's own battles instead of scanning every battle, so a poll whose kinds include quiet_crossed costs milliseconds rather than half a second. What it decides is unchanged.",
      "elixir_data_insights: the snapshot counts come from one read of the snapshots instead of four. The numbers are unchanged.",
    ),
    "No schema change. JSON API 3.1.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
