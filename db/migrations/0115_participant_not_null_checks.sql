-- 0115: NOT NULL on battle_participant.battle_time and type, step one
-- of three (schema review 1.4). The honest shape after the 0099
-- backfill completed is NOT NULL with no default on both copies; a
-- direct SET NOT NULL scans the table under ACCESS EXCLUSIVE, so the
-- proof is a CHECK instead: added NOT VALID here (instant), validated
-- in 0116 under SHARE UPDATE EXCLUSIVE, and 0117's SET NOT NULL then
-- skips its own scan (PostgreSQL 12+). Three migrations because each
-- ALTER's lock lives to the end of its transaction.
alter table battle_participant
  add constraint bp_battle_time_nn check (battle_time is not null) not valid;
alter table battle_participant
  add constraint bp_type_nn check (type is not null) not valid;
