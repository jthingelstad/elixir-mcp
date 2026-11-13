-- 0255: a participant's cards, a duel round's cards and a deck's cards as
-- arrays on their own rows (expand).
--
-- The database is 2,402 MB on a 1 GB instance (census, 2026-11-13), and
-- 879 MB of it is the two card tables 0091 made: battle_participant_card
-- (547 MB, 2,030,086 rows, its primary key alone 288 MB) and deck_card
-- (332 MB, 874,343 rows), each row carrying a 64-character battle_id or
-- deck_hash for one 4-byte card id. 0091 was written for "traverse cards
-- all over the place" (Jamie, 2026-09-15); Jamie, 2026-11-13: "All of
-- that has come off the table, so we really need to refactor the
-- database for the current vision for Elixir", and of its design: "the
-- same way that you own the code base, you own the database". Every
-- reader today is scoped to one player, a clan, a battle or a deck, so
-- the cards ride the row that owns them.
--
-- Lossless: every field of every battle_participant_card row lands here.
-- The four card arrays are parallel and indexed by slot (cards[i] is the
-- card in slot i, as the API listed them); a slot with no row is a NULL
-- element in all four, and a NULL level or star level is a NULL element
-- where cards[i] is set. Slot 0, the tower troop (supportCards), is the
-- four tower_* columns. A duel's participant row has no round-0 cards:
-- its decks are its rounds', on battle_participant_round, with
-- cards_used beside them. deck's arrays hold its identity in the
-- canonical (card_id, form) order, any number of cards.
--
-- Not here: history is filled by the migrate op {card_arrays}, and
-- {card_arrays_census} compares the arrays with the rows. Ingest writes
-- both from this deploy. Readers move once the census reports zero; the
-- two tables contract after that.
--
-- Nullable columns with no default: catalog-only, nothing rewritten.
-- Fail fast behind a long read rather than queue ingest.
set local lock_timeout = '5s';

alter table battle_participant
  add column cards          integer[],
  add column card_forms     smallint[],
  add column card_levels    smallint[],
  add column card_stars     smallint[],
  add column tower_troop_id integer,
  add column tower_form     smallint,
  add column tower_level    smallint,
  add column tower_star     smallint;

alter table battle_participant_round
  add column cards       integer[],
  add column card_forms  smallint[],
  add column card_levels smallint[],
  add column card_stars  smallint[],
  add column cards_used  boolean[];

alter table deck
  add column card_ids   integer[],
  add column card_forms smallint[];

comment on column battle_participant.cards is
  '0255: the card ids this participant played (round 0), indexed by slot: cards[i] is slot i as the API listed them (1-8 in a normal deck). A NULL element is a slot with no card. Null for a duel (its rounds hold the decks) and until {card_arrays} fills history. Replaces battle_participant_card.';
comment on column battle_participant.card_forms is
  '0255: the form bit field of cards[i] (0 base, 1 Evolution, 2 Hero, 3 both), the same slots.';
comment on column battle_participant.card_levels is
  '0255: the level cards[i] was played at, on the in-game scale; a NULL element where the API sent none.';
comment on column battle_participant.card_stars is
  '0255: the star level of cards[i]; a NULL element where the API sent none (most cards).';
comment on column battle_participant.tower_troop_id is
  '0255: the tower troop played (supportCards, battle_participant_card slot 0); null when none.';
comment on column battle_participant.tower_form is
  '0255: the tower troop''s form bit field; null when there is no tower troop.';
comment on column battle_participant.tower_level is
  '0255: the tower troop''s level; null when none or not sent.';
comment on column battle_participant.tower_star is
  '0255: the tower troop''s star level; null when none or not sent.';
comment on column battle_participant_round.cards is
  '0255: this round''s card ids, indexed by slot as battle_participant.cards is; with card_forms, card_levels, card_stars and cards_used the round''s battle_participant_card rows.';
comment on column battle_participant_round.cards_used is
  '0255: whether cards[i] was played in the round, as the API says; a NULL element where it did not say.';
comment on column deck.card_ids is
  '0255: the deck''s cards (not the tower troop), in canonical (card_id, form) order; with card_forms the deck''s deck_card rows.';
comment on column deck.card_forms is
  '0255: the form of card_ids[i], the same order.';
