-- 0158: when a board's standings last moved, stamped on the snapshot.
--
-- A snapshot is written whenever the board's content hash changes, and
-- that hash carries each place's clan. So a board whose ranks and ratings
-- are frozen still gets a new snapshot every day a player's clan changes.
-- The Gym found this on 2026-09-23 (feedback #137). Merge Tactics board
-- 170000008 had identical ranks and ratings from 09-12 to 09-23, but its
-- observed_at said today, so a closed event's standings read as today's
-- leaderboard.
--
-- standings_hash covers only (rank, player_tag, rating). standings_changed_at
-- is the observed_at of the first snapshot in the current run of equal
-- standings hashes. Ingest stamps both columns. Here we backfill only the
-- mode boards, which are the ones the readers serve this on. That is a few
-- hundred snapshot rows. ranking_entry is only read by its primary key and
-- is never rewritten.

set local lock_timeout = '5s';

alter table ranking_snapshot
  add column standings_hash text,
  add column standings_changed_at timestamptz;

with h as (
  select s.snapshot_id, s.location_key, s.observed_at,
         (select md5(string_agg(e.rank || ':' || e.player_tag || ':' || coalesce(e.rating::text, ''),
                                ',' order by e.rank))
            from ranking_entry e where e.snapshot_id = s.snapshot_id) as hash
    from ranking_snapshot s
   where s.board = 'mode'
), c as (
  select h.*, lag(hash) over (partition by location_key order by observed_at) as prev
    from h
), runs as (
  select c.*,
         max(case when prev is distinct from hash then observed_at end)
           over (partition by location_key order by observed_at) as changed_at
    from c
)
update ranking_snapshot s
   set standings_hash = r.hash, standings_changed_at = r.changed_at
  from runs r
 where s.snapshot_id = r.snapshot_id;
