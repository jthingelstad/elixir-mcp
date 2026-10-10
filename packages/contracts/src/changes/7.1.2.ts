import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.2",
  date: "2026-09-24",
  summary: md(
    "`elixir_timeline` after the Elixir Gym's third run on it (feedback #211-#218), with the week-fame fix it shares with the war tools (#223).",
    list(
      "A late capture is a battle the record learned more than a day after it was played, in every window. It had been measured against `from`, so the same backfilled session was a standout in a wide window and missing from a narrow one around its capture; late captures are counted in `battles.late_captures` and never narrated (#211).",
      "A clan entry whose window ends before that week's race closed reads the race as it stood then: fame and place at the last war day closed by `to`, no `race_finished_at`, and `as_of_window_end: true`. A past window had served the week's final 10,146 and a finish five days after `to` (#213).",
      "A finished regular week's fame is the banked progress, not the race log's capped 10,000, in `week_resolved`, the entry's `war.resolved` and `war_history` alike: ingest raises it from the day logs and migration 0164 repairs the stored weeks (136/1: 10,146; 130/0: 13,244) (#214, #223).",
      "A window before the war ledger's start says war moments and `war.resolved` begin there and points at `war_history` (#215).",
      "A past week's clan donations sum the members at the window's end, not today's roster (#216).",
      "`elixir_data_insights` says `profiles` counts every player ever read, including those no longer recorded, beside the recorded population the badge and profile tools draw on (#217).",
      "The paging findings (#211-#212 continuation cases) are superseded by 7.0.0's newsfeed, which has no continuation page.",
    ),
    "Additive; stored week fame and the ledger's week_resolved fame change for weeks the log capped.",
  ),
} satisfies ChangelogEntry;
