-- 0290: the scan for 0289's player_event_type_check, under SHARE UPDATE
-- EXCLUSIVE: inserts go on while it reads, as 0287 did for 0286.
set local lock_timeout = '5s';

alter table player_event validate constraint player_event_type_check;
