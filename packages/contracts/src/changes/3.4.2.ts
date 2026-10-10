import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.4.2",
  date: "2026-09-15",
  summary:
    "elixir_timeline: an arena move is polled for as soon as the player's own Trophy Road battles vouch for it (a battle entered with at least the opponent's trophies, since a battle's arena is the higher side's), so arena_changed lands within the battle log's cadence instead of the profile's eight hours. Profile-derived moments (arena_changed, ranked_promotion, best_trophies_band, collection_level_step, career_wins_step, card_unlocked, badges) and donation_reset are now diffed against the latest snapshot observation and written once; they were re-emitted by every later poll the same day. No tool changes shape.",
} satisfies ChangelogEntry;
