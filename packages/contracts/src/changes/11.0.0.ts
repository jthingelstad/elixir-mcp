import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.0.0",
  date: "2026-10-02",
  summary:
    "Elixir records the histories you ask it to keep: your games, friends and clans. Global leaderboard tools, game-wide meta statistics, synergy and gameplay/upgrade recommendations have retired. Card catalog facts and art, owned inventory, personal profile ranks, factual deck labels, game events and scoped history remain. Public card pages show catalog facts; sent editorial email stays in history. Meta rollup schedules and the editorial model worker are removed. Historical data awaits the separately reviewed purge.",
  breaking:
    "rankings_players, rankings_clans, rankings_clan_ladder, rankings_timeline, battles_meta_decks, battles_meta_cards, cards_synergy, battles_deck_sets and battles_deck_upgrades are removed. The corpus segment is refused. cards_card serves catalog facts, earliest selected-history play and clan member played/held lists; its season/history/deck/partner/prior statistics are removed. cards_archetype remains a descriptive vocabulary and classifier without corpus counts. Refresh tools/list. JSON API remains 3.0.0; its supported operation shapes are unchanged.",
} satisfies ChangelogEntry;
