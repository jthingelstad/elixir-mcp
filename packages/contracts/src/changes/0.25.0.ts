import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.25.0",
  date: "2026-09-06",
  summary:
    "players_profile now answers the player as a game entity, not just a name and a clan tag. clan gains badge_id and the player's role in it; a new attributes block carries arena_id, best_trophies, favorite_card_id, years_played and account_age_days; and a badges list carries current badge state, where YearsPlayed.progress is days played. All of it already arrived in every recorded player payload and was discarded, so a consumer wanting the clan badge, the clan role or an account age had to spend a live Clash Royale read on facts the record already held. Ids only, never icon URLs: names and art resolve through cards_catalog.",
} satisfies ChangelogEntry;
