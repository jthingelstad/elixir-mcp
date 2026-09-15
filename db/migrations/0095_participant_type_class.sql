-- The shrinkage prior stops scanning the corpus through a join.
--
-- Every scoped meta call (a clan's deck or card meta, 12k decided rows)
-- was taking 15 s: corpusPrior() computes ONE scalar - the corpus mean
-- win rate for shrinkage - by joining every participant in the window
-- to battle for type_class. Measured live on 3.4.0 after the readers
-- moved onto the card rows: clan deck meta 15.3 s, clan card meta 17.3 s,
-- of which the segment's own aggregate is well under a second.
--
-- type_class is denormalized onto the participant the way battle_time
-- and clan_tag already are (0001, 0089: the covering indexes exist so
-- reads never join for a filter), and the prior gets a covering partial
-- index: an index-only scan over the window instead of a join.

-- default 'pvp' exists for rows written by hand (tests, repairs); ingest
-- always supplies the battle's own value.
alter table battle_participant add column type_class text not null default 'pvp'
  check (type_class in ('pvp', 'boat'));

-- The default already says pvp; only the boat rows need a real write
-- (a few thousand), not a rewrite of every participant.
update battle_participant bp
   set type_class = b.type_class
  from battle b
 where b.battle_id = bp.battle_id and b.type_class <> 'pvp';

create index battle_participant_prior
  on battle_participant (battle_time)
  include (outcome)
  where deck_hash is not null and type_class = 'pvp';
