import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.14",
  date: "2026-09-24",
  summary: md(
    "Training days are recorded (Jamie, 2026-09-24): the practice decks members play on a race week's training days had been dropped, a holdover from elixir-bot.",
    list(
      "`war_current.training_today` on a training day: `training_day` (1-3), `trained` (each member with practice decks so far today) and `not_trained_count`.",
      "`war_history.member_weeks[].training_decks`: the week's practice decks per member; null for a week before 2026-09-24.",
      "Training never counts as war attendance: `decks_today`, `war_days` and `decks_used` are unchanged.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
