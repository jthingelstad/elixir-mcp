import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.15.1",
  date: "2026-09-19",
  summary: md(
    "Three things the Phase 2 acceptance read surfaced.",
    list(
      "`finish_time` on `war_current.standings[]`, the exact week's `war_history.standings[]` and `race_finished_at` is null for a clan that did not finish: the API marks those with epoch zero (`1969-12-31T23:59:59Z`) and the sentinel was served as a time.",
      "Each day's standings on `war_history.days[]` and `war_current.days_closed[]` carry `rank` (1-based, null while unranked) beside `end_of_day_rank` (the API's 0-based value, -1 unranked).",
      "The recorder now keeps a section's fourth war day, which is first reported in the next section's polls and was dropped: `days[]` carries four entries on a full week once the archive re-walk has run.",
    ),
    "Additive; the added field is `rank`.",
  ),
} satisfies ChangelogEntry;
