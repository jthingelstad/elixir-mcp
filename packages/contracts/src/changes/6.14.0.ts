import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.14.0",
  date: "2026-09-21",
  summary: md(
    "players_collection at full verbosity fits again. A mature collection's full answer was ~55k characters against the 48k result cap - every read refused, and with no limit to narrow, the refusal could not price a retry. 31k of it was the catalog repeated per card.",
    list(
      "Collection rows no longer carry `iconUrls`, `rarity`, `elixirCost`, `maxLevel` or `maxLevelRarityScale`: they are the same for every player and `cards_catalog` carries them once. A row keeps id, name, level, count, starLevel, evolutionLevel, maxEvolutionLevel, forms_available and forms_unlocked. A 126-card collection reads ~24k at full.",
    ),
    "A minor, not a major, by Jamie's call (2026-09-21): the fields removed are catalog facts, and no client could receive the full answer for a mature collection - the last week's reads were all compact. Also in this version: every tool now publishes an outputSchema in tools/list (23 more - badges_rarity, battles_cards, battles_compare, battles_opponents, battles_trends, cards_card, cards_catalog, cards_synergy, elixir_changelog, elixir_collectors, elixir_data_insights, elixir_docs, elixir_examples, elixir_updates, game_clock, game_events, players_collection, players_names, players_search, rankings_clan_ladder, rankings_clans, rankings_timeline, war_rivals), permissive below the top level as the others are.",
  ),
} satisfies ChangelogEntry;
