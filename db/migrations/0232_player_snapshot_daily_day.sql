-- 0232: A narrow index on snapshot days.
-- The hourly public stats snapshot counts player_snapshot_daily. The table
-- holds about 14,500 rows in 69 MB of heap: its rows were deleted in bulk in
-- October and the pages stayed. The planner counted it by reading the whole
-- heap, 7,566 blocks from disk in the 2026-10-21 profile (572 of the totals
-- statement's 887 ms; platform review §3, 185 runs over a second in a week).
-- A fresh index on the date column is a few dozen pages, so the same exact
-- count is an index-only scan of it. Additive: no row and no answer changes;
-- updates never touch snapshot_date, so they stay HOT. SHARE lock: reads
-- continue, snapshot writes wait for the bounded build; fail fast behind a
-- conflicting writer.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index player_snapshot_daily_day on player_snapshot_daily (snapshot_date);

comment on index player_snapshot_daily_day is
  '0232: the public totals count snapshots from this index, not the sparse heap.';
