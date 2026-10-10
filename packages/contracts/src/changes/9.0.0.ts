import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.0.0",
  date: "2026-09-25",
  summary: md(
    "Participation keeps weekly war-deck facts and drops unreliable daily allocations (Jamie, 2026-09-25).",
    list(
      "`clans_participation.members[]` keeps `war_decks` as the total for each recorded war week, with `war_points` and `war_scoring_decks` where full verbosity serves them.",
      "`war_decks_by_day`, `war_battles_by_day` and `war_days_battled` are removed from participation. Sampled game counters and recorded battles cannot reliably allocate a weekly deck total to the game's individual days. `war_history` remains the exact-week surface for its separately observed attendance facts.",
    ),
  ),
  breaking:
    "Clients reading any removed participation day field must use the weekly total instead.",
} satisfies ChangelogEntry;
