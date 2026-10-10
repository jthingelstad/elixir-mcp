import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.1.2",
  date: "2026-09-25",
  summary: md(
    "`war_current.decks_today` and the timeline's clan `war.decks` read the game's own `decksUsedToday` counter for the day in progress, as the race poll recorded it. They took the larger of that counter and the member's war battles placed on the 10:00Z policy day, which is the per-day attribution 9.0.1 retired everywhere else, so the count can now trail play by a poll instead of guessing ahead of it.",
    "`decks_today.over_cap` (and its `decks_observed`) is gone: it listed members the battle placement put past four decks on a clan whose real reset drifted across the policy hour, and without the placement nobody can be.",
  ),
} satisfies ChangelogEntry;
