import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.26.0",
  date: "2026-09-07",
  summary:
    "war_current: period_end_nominal and week_end_nominal were wrong whenever the ~10:00 UTC reset drifted early. A period first seen open at 09:57Z reported its end as 10:00Z that same morning - about 24 hours early, and already in the past by the time anybody read it. Both now anchor on the period's own nominal start, so the end is a full day later. decks_today was gated on that boundary and therefore vanished on a live war day; it is back. clans_pilot_scores gains a basis block (curve_pairs, curve_bins, window_from, window_to): the level curve is refit over a rolling window on every request, so a member's score can move with no new battles of their own, these counts provide volume context, but cannot establish that the fitted curve is unchanged (clarified in 0.36.0). Reported by an agent through elixir_feedback.",
} satisfies ChangelogEntry;
