-- 0133: the roster's own stamp on the snapshot row (time-series review,
-- Phase 1 verification item 1). The roster upsert guarded every column
-- on observed_at, which the profile also advances, so a roster
-- observation older than the same day's last profile poll wrote
-- nothing, including the four columns the profile never writes
-- (clan_tag, clan_rank, previous_clan_rank, game_last_seen_at). Live
-- that costs fifteen minutes; in the archive backfill it is systematic
-- (one roster a day at ~02:21Z, profile polls later the same game day,
-- and the profile rows already exist), so clan_tag would stay null on
-- most backfilled days. Nullable, instant; the rows the roster has
-- written since 0127 take their observed_at (nothing else moved it on
-- a roster-written row before the profile's stamp existed alongside).
alter table player_snapshot_daily add column roster_observed_at timestamptz;
comment on column player_snapshot_daily.roster_observed_at is
  'When the roster last wrote its own columns (clan_tag, clan_rank, previous_clan_rank, game_last_seen_at); the shared columns are dated by observed_at, the profile''s by profile_observed_at.';
update player_snapshot_daily set roster_observed_at = observed_at
 where clan_tag is not null and roster_observed_at is null;
