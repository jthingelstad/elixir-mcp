# 2026-11-13 — Cards as arrays on the rows that own them (expand)

Migration 0255. No contract change, no reader change.

**Why.** The production database is 2,402 MB on a db.t4g.micro with
1 GB of memory, and 879 MB of it is the two card tables 0091 made:
`battle_participant_card` (547 MB for 2.03 million rows, its primary key
alone 288 MB) and `deck_card` (332 MB for 874 thousand rows). Each row
carries a 64-character `battle_id` or `deck_hash` for one 4-byte card id.
0091 was built to traverse cards across the whole record. Jamie,
2026-11-13: "All of that has come off the table, so we really need to
refactor the database for the current vision for Elixir", and "the same
way that you own the code base, you own the database". Every card reader
today is scoped to one player, one clan, one battle or one deck, so the
cards move onto the row that owns them.

**The shape.** All columns are nullable, added catalog-only under a
5 s `lock_timeout`.

- `battle_participant`: `cards int4[]`, `card_forms`, `card_levels` and
  `card_stars` (`smallint[]`), parallel and indexed by slot. Element *i*
  is the card the API listed *i*th. The tower troop (slot 0) goes in
  `tower_troop_id`, `tower_form`, `tower_level` and `tower_star`.
- `battle_participant_round` (a duel's rounds): the same four arrays,
  plus `cards_used boolean[]`.
- `deck`: `card_ids int4[]` and `card_forms smallint[]`, in canonical
  (card_id, form) order, any number of cards.

**Lossless.** Every field of every `battle_participant_card` row has a
place:

- A slot with no row is a NULL element in all four arrays.
- A missing level or star level is a NULL element where the card id is
  set.
- `cards` is an empty array when round 0 has only a tower troop. So a null
  `cards` means only "no round-0 rows": a duel, whose decks are on its
  round rows, or a participant with no deck.
- `used` exists only in duel rounds (the API sends it nowhere else), so
  the participant row has no `used` array.

**Departure from the planned column list.** `tower_form` was added: a
slot-0 row has a form, and dropping it would lose a field.

**Dual-write.** Ingest writes both shapes in the battle's transaction.
`packages/ingest/src/card-arrays.mjs` builds the arrays in SQL from the
rows just written, so they equal the rows by construction:

- the deck arrays after `deck_card`;
- the participant arrays after `battle_participant_card`;
- the round arrays after the round rows.

Each update is guarded by IS DISTINCT FROM, so a resubmission writes
nothing. During the transition a new participant row takes one extra row
version.

**History and proof.** Both ops are in `.claude/skills/ops/ops.md` and
the "Card arrays" bullet of `docs/OPERATIONS.md`.

- `{card_arrays}` (WRITE) fills rows that are still null, with the same
  SQL: participants, then rounds, then decks. It works in keyed batches,
  one statement each, inside 45 s per call, and is idempotent and
  resumable from the `next` it returns.
- `{card_arrays_census}` (Read) unnests every array and full-joins the
  card rows on (battle, player, round, slot) and every field, and compares
  each deck with its `deck_card` rows. `pass: true` is the gate for moving
  readers.

**Not placed.** The arrays cannot hold two rows in one slot (a second
`supportCards` entry would share slot 1) or two slot-0 rows. The fill
leaves those participants null, and the census counts them.

**Next.** First move readers to the arrays. Then contract:
`battle_participant_card` and `deck_card` go once nothing reads them.
