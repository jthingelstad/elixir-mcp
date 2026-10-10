import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.4.0",
  date: "2026-09-15",
  summary:
    "Cards played are recorded as rows (deck, deck_card, battle_participant_card), so every card question is an indexed lookup instead of a scan of every deck's JSON. battles_query gains with_cards (several ids, all present in your deck); with_card and against_card use the same rows. battles_cards, battles_meta_cards and cards_synergy count from the rows with unchanged denominators; battles_decks, battles_meta_decks and players_summary render a deck's cards from its identity (ordered by card id, named from the catalog) rather than from one player's copy, so the cards list no longer carries per-battle levels or a norm marker. Card filters match the deck's cards, not the tower troop or a duel's separate rounds. An empty cards list has no deck_hash.",
} satisfies ChangelogEntry;
