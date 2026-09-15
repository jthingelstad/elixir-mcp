-- Cards played become rows (Jamie, 2026-09-15: "we need to be able to
-- traverse cards all over the place").
--
-- Until now the only place a played card lived was battle_participant.deck,
-- a jsonb copy of the API's cards array, keyed by a deck_hash that pointed
-- at no row. Every card question - card meta, synergy, "which battles had
-- these three cards", "everyone who played this exact deck" - re-exploded
-- that JSON across the window with no index able to help (the 2026-09-14
-- 22:00Z burst: 17 invocations killed at Lambda's 25 s ceiling), and
-- nothing checked that a played card existed in the catalog.
--
-- Three projections, all rebuildable from the JSON that stays in place:
--   deck                    one row per deck identity (deck_hash, as the
--                           contract already defines it), tower troop as
--                           a card FK
--   deck_card               the cards of a deck, by form
--   battle_participant_card the fact: what each participant played in each
--                           battle, with the level they played it at
-- and the FKs that make card identity a constraint instead of a convention.
--
-- Expand phase, purely additive: nothing deployed reads the new tables
-- yet, ingest dual-writes from this deploy, and the migrate op
-- {deck_backfill} fills history in batches. The two constraints that
-- close the loop - battle_participant.deck_hash -> deck and
-- player_card.card_id -> card - land in 0092 once {deck_census} reports
-- zero orphans and the readers (and their tests, which seed participants
-- by hand today) have moved onto these tables. The jsonb columns
-- contract away after that (Phase C).
--
-- A card seen in a battle before the daily catalog poll knows it gets a
-- stub row here (id, name and kind are in the battle payload; the rest
-- is null) so ingest never pauses on catalog integrity; catalog_seen_at
-- is null until /cards confirms it, and ingest queues a live catalog
-- fetch the moment it writes one (Jamie: loading battles is more
-- important than eventual catalog integrity).

alter table card add column catalog_seen_at timestamptz;
update card set catalog_seen_at = observed_at;
comment on column card.catalog_seen_at is
  'When /cards last confirmed this card; null for a stub written from a battle payload ahead of the catalog.';

create table deck (
  deck_hash      text primary key,
  tower_troop_id integer references card,
  card_count     smallint not null,
  first_seen_at  timestamptz not null,
  last_seen_at   timestamptz not null
);
comment on table deck is
  'One row per deck identity: the contract''s deck_hash (sorted card:form pairs plus tower troop). Card levels are not identity.';

create table deck_card (
  deck_hash text     not null references deck,
  card_id   integer  not null references card,
  form      smallint not null default 0 check (form between 0 and 2),
  primary key (deck_hash, card_id, form)
);
create index deck_card_card on deck_card (card_id, form, deck_hash);
comment on table deck_card is
  'The cards of a deck. form is the CR form discriminator (0 base, 1 Evolution, 2 Hero); two forms of a card are two slots.';

create table battle_participant_card (
  battle_id  text     not null,
  player_tag text     not null,
  round      smallint not null default 0,
  card_id    integer  not null references card,
  form       smallint not null default 0 check (form between 0 and 2),
  slot       smallint not null,
  level      smallint,
  star_level smallint,
  primary key (battle_id, player_tag, round, card_id, form),
  foreign key (battle_id, player_tag) references battle_participant (battle_id, player_tag)
);
create index battle_participant_card_card
  on battle_participant_card (card_id, form, battle_id);
create index battle_participant_card_player
  on battle_participant_card (player_tag, card_id, form);
comment on table battle_participant_card is
  'What a participant played in a battle: one row per card (slot 1-8 as the API listed them, slot 0 the tower troop), level on the in-game scale. round is 0 except in duels, where each round is its own deck.';
