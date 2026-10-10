import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.15",
  date: "2026-09-24",
  summary: md(
    "Training-day decks before 2026-09-24 are rebuilt from recorded battles (Jamie, 2026-09-24).",
    list(
      "`war_history.member_weeks[].training_decks` covers earlier weeks: river-race battles on a week's training days, credited to the clan the member played them for (a 1v1 is one deck, a duel one per round, four a day at most). A rebuilt figure is a floor where a member's log was not fully captured; the race poll's own count wins wherever it exists.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
