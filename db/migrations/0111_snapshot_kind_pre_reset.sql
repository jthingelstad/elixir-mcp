-- 0111: a snapshot kind that said "season" and meant "Monday" (schema
-- review 1.6, plan step 10). The extra row written in the hour before
-- the WEEKLY donation reset (Monday 00:10Z) was called season_roll; it
-- is pre_reset, and season_roll is reserved for the row taken in the
-- hour before season.ends_at (first Monday 10:00Z), which is the
-- observation that captures leagueStatistics.currentSeason and the last
-- Path of Legends standing before they reset. 996 rows, instant. The
-- kinds still sort daily < pre_reset < season_roll, so every "latest
-- row" tiebreaker (order by snapshot_kind desc) keeps its meaning.
alter table player_snapshot_daily drop constraint player_snapshot_daily_snapshot_kind_check;
update player_snapshot_daily set snapshot_kind = 'pre_reset' where snapshot_kind = 'season_roll';
alter table player_snapshot_daily
  add constraint player_snapshot_daily_snapshot_kind_check
  check (snapshot_kind in ('daily', 'pre_reset', 'season_roll'));
