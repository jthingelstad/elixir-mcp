import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.11.0",
  date: "2026-09-26",
  summary: md(
    "A Clan Wars duel counts as its rounds everywhere a deck or card is counted (feedback #363). A duel is up to three games, each with its own deck, and as one row with no deck it was in no one's meta: a war deck played only in duels was invisible, and roughly half of a clan's war games never reached the season rollups. Each round now carries its own `deck_hash` (its eight cards, no tower troop, the identity a Clan Wars battle has) and its own result by that round's crowns, and counts as one game.",
    list(
      "`battles_meta_decks`, `battles_meta_cards` and `cards_card` (season, forms, history, bands, decks): war and all-mode rows count duel rounds, and each row carries `duel_rounds`, how many of its battles were rounds (null on a season rollup row until the nightly rebuild splits it). The meta tools carry `duel_rounds` beside `decided_battles` too. `excluded` still counts battles: a duel is one battle in `considered` and `excluded.duels`, and its rounds are decided games, so `considered` still matches `battles_query` and `battles_trends`.",
      "`cards_synergy`: a round's deck is walked like any deck.",
      "`battles_cards`: each round is a game, with the cards played that round and that round's result (the opponent's cards from the same round).",
      "`battles_deck_sets` and `battles_deck_upgrades`: the season's war record holds every player's duel rounds, so the player's own are no longer added on top; `modes.<mode>.duel_rounds` replaces `modes.war.your_duel_rounds`. The deck row's `your_duel_rounds` is unchanged.",
    ),
    "`battles_decks` is unchanged: its rows are battles with one deck, and `duel_decks` lists the round decks apart. Additive, apart from `modes.war.your_duel_rounds`.",
  ),
} satisfies ChangelogEntry;
