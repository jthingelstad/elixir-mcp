-- 0262: A player's profile rows by when they were observed.
-- The timeline reads each followed player's last profile at or before the
-- window's start and end (entries.mjs snapshotSql: profile_observed_at <=
-- an instant, newest first, limit 1). With no index on the observation
-- time the read took every one of the player's day rows from the wide
-- snapshot heap, one to a page, and sorted them: on a synthetic year about
-- 21,000 pages from disk per statement for 55 followed players, twice per
-- read, the bulk of elixir_timeline's 6 to 11 s first call (2026-11-13).
-- Here each player is one probe and one heap page.
-- Records and query semantics are unchanged. Sized with {tables}
-- 2026-11-13: about 20,000 live rows; the index is about 1 MB. It adds
-- no HOT cost: profile_observed_at is already in 0261's cover.
-- The build takes a SHARE lock (reads continue, ingest waits seconds).
-- Fail fast behind a conflicting writer; the deploy retries.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index player_snapshot_daily_profile_time
  on player_snapshot_daily (player_tag, profile_observed_at desc)
  where profile_observed_at is not null;

comment on index player_snapshot_daily_profile_time is
  '0262: a player''s last profile at or before an instant (the timeline''s before and after reads), one probe per player.';
