-- 0287: the scan for 0286's player_event_type_check, under SHARE UPDATE
-- EXCLUSIVE: inserts go on while it reads, as 0193 did for 0192.
set local lock_timeout = '5s';

alter table player_event validate constraint player_event_type_check;
