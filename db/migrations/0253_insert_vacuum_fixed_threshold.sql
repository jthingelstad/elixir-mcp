-- 0253: insert-driven vacuum at a fixed count on the battle and snapshot
-- tables (2026-11-13).
--
-- The index-only reads of clans_participation and the player/time
-- covers (0249, 0250) stay index-only only while the visibility map
-- covers the pages they read, and the pages they read are the newest.
-- 0103 set battle and battle_participant to an insert-driven vacuum at
-- 2% growth, sized when the tables were millions of rows; the 2026-10-02
-- right-sizing left them small, so the trigger (1,000 + 2% of the table)
-- became a count that takes days to reach. {tables} on 2026-11-13:
--
--   table                  live rows  trigger  inserts/day  last autovacuum
--   battle                   105,068    3,100       ~570      2026-11-09
--   battle_participant       225,664    5,500     ~1,200      2026-11-09
--   player_snapshot_daily     20,220    5,044 *     ~600      2026-11-08
--   (* the default 1,000 + 20%; no table options)
--
-- HOT pruning keeps their dead tuples near zero (44, 62, 1,350), so the
-- dead-tuple trigger does not fire either. Heap fetches in the
-- participant reads were 1,985 before a manual {vacuum} on 2026-11-13
-- and 8 after (note 2026-11-13-participation-reads-cheap).
--
-- This sets the insert scale factor to 0 and a fixed threshold sized to
-- about one day of inserts on each table: battle 500, battle_participant
-- 1,000, player_snapshot_daily 500 (from the stats series: about 570
-- battles a day at about 2.1 participants each; one snapshot row a day
-- for each of about 600 recorded players and members). An insert-driven
-- vacuum visits only the pages the map does not already cover (a few
-- hundred a day here), skips index cleanup when there is almost nothing
-- dead (PostgreSQL 14+), and reads through a small ring buffer, so a
-- daily run is a few seconds of I/O on the db.t4g.micro and takes none
-- of its roughly 100 MB of freeable memory beyond what it needs for its
-- few dead tuples. The 0103 dead-tuple and analyze settings stay.
-- Checked a week on with {tables}: last_autovacuum within a day and
-- all_visible_pct above about 98 on each, with no manual {vacuum}.
--
-- Not here: a manual VACUUM, which is the {vacuum: {table}} op.
--
-- Each ALTER takes a SHARE UPDATE EXCLUSIVE lock for an instant (it
-- conflicts with a running vacuum, not with reads or writes); fail fast
-- behind one rather than queue.

set local lock_timeout = '5s';

alter table battle set (
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 500
);
alter table battle_participant set (
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 1000
);
alter table player_snapshot_daily set (
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 500
);
