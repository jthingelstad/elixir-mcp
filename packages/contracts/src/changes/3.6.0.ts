import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.6.0",
  date: "2026-09-15",
  summary:
    "elixir_timeline: ranked_promotion carries facts.promoted_by (the last win played in the league below - a ranked battle is stamped with the league it started in); best_trophies_band carries facts.band and facts.crossed_by (the Trophy Road win whose result first reached the band); career_wins_step carries facts.step and facts.crossed_by (the 1,000th win itself, only when the window's wins reconcile with the lifetime counter). One battle shape everywhere: battle_id, battle_time, type, opponent {player_tag, name, starting_trophies} or opponents[] for a team battle, crowns, crowns_against, trophy_change, trophies_after when carried; the arena moment's promoted_by gains type. Each such item's at is the battle's instant. Clan standouts.ranked_promotions gain over and score. Additive.",
} satisfies ChangelogEntry;
