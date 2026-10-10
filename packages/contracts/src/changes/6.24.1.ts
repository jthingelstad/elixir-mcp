import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.24.1",
  date: "2026-09-23",
  summary: md(
    "Fixes to what 6.23.0 shipped.",
    list(
      "`clans_participation` serves `war_scoring_decks` for windows of up to five war weeks. At six to eight, the full response ran past the result cap and was refused, and the note points to `war_history.scoring_decks` instead.",
      "`clans_timeline`'s general note is back to its old wording. The `members_*_plus` coverage caveat rides only on days that were not fully profiled, as the Gym's control asks.",
    ),
    "No shape change beyond when war_scoring_decks appears.",
  ),
} satisfies ChangelogEntry;
