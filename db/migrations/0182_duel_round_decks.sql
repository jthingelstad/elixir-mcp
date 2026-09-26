-- 0182: a duel round carries its own deck identity and result.
--
-- Feedback #363 (2026-09-26) and Jamie's go the same morning ("proceed
-- with the backfill for duel support"): a Clan Wars duel is up to three
-- games, each with its own deck, and a duel has no deck_hash, so about
-- half of a clan's war games (King Thing: 31 duels beside 50 1v1s over 8
-- weeks) never reached the season rollups or the meta tools. The round's
-- cards already ride battle_participant_card.round and its crowns
-- battle_participant_round (0151); this adds the two things a rollup
-- needs beside them: the round's eight cards' deck_hash (with no tower
-- troop, the identity every Clan Wars battle already has, since the API
-- sends none on a war battle) and the game's result by that round's
-- crowns against the opponent's.
--
-- Nullable, no default: catalog-only. Ingest stamps new rounds from this
-- deploy; history is filled by the migrate op {duel_round_decks}, not
-- here (the old code writes rounds until the flip). Readers move once it
-- reports done. The table is small (23k rows); lock_timeout bounds the
-- brief ACCESS EXCLUSIVE.

set local lock_timeout = '5s';

alter table battle_participant_round
  add column deck_hash text,
  add column outcome text;

comment on column battle_participant_round.deck_hash is
  'The round''s deck (0182): its eight cards'' deck_hash with no tower troop, the identity a Clan Wars battle has; its deck and deck_card rows are written beside it. Null for a round whose cards are not all recorded, or not yet filled by {duel_round_decks}.';
comment on column battle_participant_round.outcome is
  'The game''s result (0182): win, loss or draw by this round''s crowns against the opponent''s crowns in the same round. Null when either side''s crowns are unknown.';
