import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.10.0",
  date: "2026-09-17",
  summary:
    "The season is a row and the meta tools read by it (docs/reviews/2026-09-16-SCHEMA-REVIEW.md 1.1). battles_meta_decks, battles_meta_cards and cards_synergy default to the CURRENT SEASON TO DATE (applied.window.source: 'season') instead of a rolling 28 days, which mixed two seasons on most days of the month; balance changes land on the season roll, so a season is the window that honours them. A season argument on those three and on battles_trends bounds one season: 'current', 'previous', the month the API names it by (2026-08) or the river race season number (135); from/to/days/weeks given still win. applied.window gains season {month, war, starts_at, ends_at} (the season the window starts in), crosses[] (every season roll inside the window, empty when clean) and season_age_days; a window across a roll carries a note saying so, and a thin new season names season:'previous' as the settled comparison rather than widening. battles_trends rows carry season_month. Balance changes and the in-game Pass season are not modelled. Additive.",
} satisfies ChangelogEntry;
