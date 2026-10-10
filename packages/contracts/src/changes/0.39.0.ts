import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.39.0",
  date: "2026-09-09",
  summary:
    "Eleven feedback items from one agent session, shipped together because they share a shape: the corpus held the detail and exposed one grouping axis per tool. NEW AXES: battles_opponents groups a player's recorded battles by opponent (record, first/last met, modes, name where known, min_battles so 'who have I faced twice' is one call); badges_rarity and badges_holders make badges a queryable dimension across every recorded profile, one-off badges told apart from tiered ones; cards_synergy answers 'what is Witch played with' with co-occurrence, distinct players per pair and lift over the partner's baseline, forms merged for the anchor by default; players_names resolves up to 100 tags to names from the corpus and lists the misses so a live fetch is a choice. NAMES: opponents and teammates carry name_known; a backfill gap (June-July archive rows without opponent names) is repaired from the recorded history. QUOTA: meta.quota on every response - daily calls and live fetches used/max/remaining, reset instant, unlimited reads as null. SCOPE: elixir_events needs only cr:read; the insufficient-scope refusal now says how to grant a capability. SIZING: elixir_data_insights reports recorded players as direct/via_clans/total, clans by scope, which clans, and how many distinct players back profile and badge questions. STATISTICS: meta tools shrink toward the CORPUS mean over the same window (a player-scoped segment no longer shrinks toward itself), flag insufficient_sample below 30 decided observations and withhold shrunk rates there, exclude boat battles, and report an excluded breakdown (duels, boat, draws, unresolved). battles_performance exposes decided_battles and boat_battles and no longer counts boat attacks in win_rate; (game_mode, type) is documented as the mode key. DUELS: card_legend states that duel crowns sum across rounds and tower_hp describes the final round; duel rows carry rounds_played; a one-tower princess array is padded to fixed length 2 with 0 for the destroyed tower. FORMS: players_collection and cards_catalog decode evolutionLevel/maxEvolutionLevel into forms_unlocked/forms_available (a bit field, never progress); cards_catalog serves maxLevel on the in-game 1-16 scale with maxLevelRarityScale alongside. Additive throughout; win_rate in battles_performance changes only for players with recorded boat battles.",
  tools_added: [
    "battles_opponents",
    "badges_rarity",
    "badges_holders",
    "cards_synergy",
    "players_names",
  ],
} satisfies ChangelogEntry;
