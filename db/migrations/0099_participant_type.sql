-- The participant carries battle.type too; no read path joins battle
-- for a filter any more.
--
-- With type_class on the row (0095) the one remaining reason the meta
-- tools joined battle was the duel exclusion (b.type = any(DUEL_TYPES))
-- in excludedBreakdown - and on a clan-scoped call that join was 4.1 of
-- the remaining ~5 s (explain_meta, after 0098). battle_time (0001),
-- clan_tag (0089), type_class (0095), now type: the same rule each time,
-- a filter reads the participant, battle is for battle facts.
--
-- The window index becomes whole (the excluded breakdown counts boat,
-- duel and deck-less rows too) and carries type; the per-player cover
-- carries the same four columns so a clan-scoped scan is index-only.

alter table battle_participant add column type text;

update battle_participant bp
   set type = b.type
  from battle b
 where b.battle_id = bp.battle_id;

-- Nullable on purpose: ingest always writes it and the update above
-- fills every existing row, so the record carries no nulls; a row
-- written by hand (tests, repairs) without it simply matches no type
-- filter, rather than lying with a default.

drop index battle_participant_window;
create index battle_participant_window
  on battle_participant (battle_time)
  include (deck_hash, player_tag, outcome, type, type_class);

drop index battle_participant_player_time_cover;
create index battle_participant_player_time_cover
  on battle_participant (player_tag, battle_time desc)
  include (battle_id, clan_tag, deck_hash, outcome, type, type_class);
