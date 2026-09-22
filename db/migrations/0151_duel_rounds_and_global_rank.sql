-- 0151: the two battle fields the payload manifest named as Tier 2 and
-- the record has been discarding since it began.
--
-- DUEL ROUNDS. A duel row collapses up to three games; the API reports
-- each round separately (crowns, king and princess tower hitpoints,
-- elixir leaked, and whether each card was played) and Elixir kept only
-- the round DECKS, in battle_participant_card.round. So the public docs
-- said a duel's tower_hp "describes the final round only" and that it
-- "has no differential" - presenting a gap in the record as a property
-- of duels. 15,091 archived battle entries carry per-round results.
--
-- GLOBAL RANK. battle_participant.global_rank is named in the manifest
-- and was never created. The field rides every participant of every
-- battle and is non-null on about one row in five (a player globally
-- ranked at battle time, overwhelmingly Path of Legends).
--
-- Both are additive and backfilled by replaying the archive; nothing
-- reads them until the contract bump that follows.

create table battle_participant_round (
  battle_id           text     not null,
  player_tag          text     not null,
  round               smallint not null,
  crowns              smallint,
  king_tower_hp       smallint,
  princess_tower_hp_1 smallint,
  princess_tower_hp_2 smallint,
  elixir_leaked       numeric,
  primary key (battle_id, player_tag, round),
  foreign key (battle_id, player_tag)
    references battle_participant (battle_id, player_tag)
);

comment on table battle_participant_round is
  'One row per game of a duel, per participant: the API reports each round of a riverRaceDuel separately and the battle_participant row carries only the sum (crowns) and the final round (tower hitpoints). round matches battle_participant_card.round, which holds that round''s deck. Empty for every non-duel battle.';

comment on column battle_participant_round.king_tower_hp is
  'Hitpoints REMAINING at that round''s end, never a level; 0 means destroyed, null means the API did not report it.';

-- Whether a card was actually played in that round (the API says so per
-- card, per round; 0 for a non-duel row where the question is not asked).
alter table battle_participant_card add column used boolean;

comment on column battle_participant_card.used is
  'Duel rounds only: whether the card was played in that round. Null outside duels, where the API does not say.';

alter table battle_participant add column global_rank integer;

comment on column battle_participant.global_rank is
  'The player''s global leaderboard position at battle time, as the API reported it on this battle; null unless they were globally ranked then. Not a rank in this record and not comparable across seasons.';

create index battle_participant_global_rank
  on battle_participant (global_rank) where global_rank is not null;
