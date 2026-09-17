-- 0116: step two (see 0115): the scans, no ACCESS EXCLUSIVE lock.
-- {enum_census}: 0 null battle_time, 0 null type.
alter table battle_participant validate constraint bp_battle_time_nn;
alter table battle_participant validate constraint bp_type_nn;
