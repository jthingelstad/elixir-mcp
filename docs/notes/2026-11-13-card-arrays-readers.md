# 2026-11-13 — Every card reader reads the arrays

No migration, no contract change: every tool, route and mail answers as
before. The second step of the move 0255 began
(`2026-11-13-card-arrays-expand.md`).

**Why now.** `{card_arrays}` filled history and `{card_arrays_census}`
passed on production on 2026-11-13: 1,972,650 participant card rows
equal 1,972,650 array elements, rounds 58,080 = 58,080, decks
874,752 = 874,752, every mismatch count 0.

**The readers.** Three shapes in `packages/tools/src/tools/shared.mjs`
unnest the arrays with the slot as the ordinality:

- `playedCardsSql(where)`: every card a participant played, a row each
  with the slot it had (0 the tower troop), round 0 from
  `battle_participant` and a duel's rounds from `battle_participant_round`.
  `renderDecks` (battles_query's decks).
- `gameCardsSql(battle, player, round)`: one game's deck cards (round 0
  the participant's deck, round n a duel's round n). battles_cards, mine
  and the opponent's.
- `holdsCardsSql(alias, ids)`: does one deck of a participant (round 0 or
  any one duel round) hold every id. battles_query's `with_card`,
  `with_cards` and `against_card`.

A deck's cards are `deck.card_ids` and `card_forms`: `deckIdentities`,
the archetype stamp (`stampDecks`), a highlight's two decks, Verify's
recent and month decks. The `{probe}` op's
level census unnests `card_levels`. `{deck_census}`, `{card_arrays}` and
`{card_arrays_census}` still read the rows on purpose; they go in the
contract step.

**No new index.** Every read is scoped to one player, clan, battle or
deck and reaches the arrays through the owning row's key. Nothing asks
"who played card X" across the record (VISION: a person's own record,
not corpus card statistics), so no GIN index over the arrays.

**Proof.** `packages/tools/test/card-arrays-readers.test.mjs` runs each
old statement and its replacement over the same record (real battle
logs through ingest, plus an empty slot, a card with no level and a
round 0 with only a tower troop) and requires equal rows. The test
fixtures (`packages/tools/test/deck-rows.mjs`) write both shapes, and
the duel in `controls.test.mjs` writes its round rows before their
cards. cards_card, which read the rows too, retired in MCP 13.0.0.

**Next.** The contract step: ingest stops writing the rows and builds the
arrays from the payload, and one migration drops `battle_participant_card`
and `deck_card`.
