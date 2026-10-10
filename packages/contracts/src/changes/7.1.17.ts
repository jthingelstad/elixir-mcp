import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.17",
  date: "2026-09-24",
  summary: md(
    "Training days are race-week days like the war days (Jamie, 2026-09-24): a member plays the same four war decks all week; on a war day each can be played once and scores, and training days are reps with them.",
    list(
      "The record keeps one row per member per day of the race week, training days included; nothing a tool serves changes shape.",
      "`war_current.training_today` and `war_history.member_weeks[].training_decks` say they are the war decks played on training days, not a separate practice count.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
