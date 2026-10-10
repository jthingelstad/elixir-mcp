import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.21",
  date: "2026-09-24",
  summary: md(
    "`war_current.decks_today` covers every day of the race week (Jamie, 2026-09-24): training days are the same four war decks, played for reps.",
    list(
      "`decks_today` carries `day_kind` (training or war), `day_in_section` (0-6), `training_day` and `war_day`, with the same untouched, partial and finished lists on a training day as on a war day. Only war-day decks score; training never counts as war attendance.",
      "`training_today` (7.1.14) is the same training picture in its old shape: deprecated, removed in the next major version.",
      "`decks_today_reason` is served only when no day is open: `period_unknown`, `war_day_over`, or `training_day` when a training day's picture cannot be read.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
