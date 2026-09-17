-- 0119: the scans for 0118, under SHARE UPDATE EXCLUSIVE.
alter table player_event validate constraint player_event_type_check;
alter table clan_event validate constraint clan_event_type_check;
alter table player_daily_battle_rollup validate constraint rollup_mode_group_check;
alter table poll_state validate constraint poll_state_hint_check;
