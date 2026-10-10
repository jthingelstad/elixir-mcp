import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.2.0",
  date: "2026-09-10",
  summary:
    "Three player-reported gaps closed together. WAR CURRENT: standings add period_points, the current war day's score, beside fame, the cumulative boat score banked at the day close; the note says why fame can still be zero while members have points. WAR HISTORY: season_id plus section_index selects one exact week and returns every recorded participant in member_weeks, including player_tag, name, points, decks, boat attacks, war_days_battled and the actual war_days indices; player_tag can still focus one. COVERAGE: completeness_last_7_days adds unmeasured_tail_hours, the explicit age of the unbracketed tail after the latest profile snapshot. Directly tracked players' profile cadence is capped at eight hours even when dormant; clan-wide members nobody tracks directly keep the yield cadence.",
  tools_added: [],
} satisfies ChangelogEntry;
