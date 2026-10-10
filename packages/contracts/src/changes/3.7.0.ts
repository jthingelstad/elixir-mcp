import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.7.0",
  date: "2026-09-15",
  summary:
    "days and weeks are accepted on every windowed tool, as the server instructions have said since 1.0.0: battles_query, battles_performance, battles_cards, battles_decks, battles_meta_decks, battles_meta_cards, battles_compare, battles_opponents, cards_synergy, elixir_timeline, rankings_timeline, game_events and players_timeline (there as N days of snapshots, today included) join the five that already took them. Sugar for from, ending now; from/to given win. Until now the other tools refused them with bad_request (a routine lost three battles_performance calls to it on 2026-09-15). Additive.",
} satisfies ChangelogEntry;
