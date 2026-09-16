-- 0103: keep battle_participant's visibility map fresh (2026-09-16).
--
-- Every Elixir Clan page sat at 8 s because clans_participation's first
-- read was a bitmap heap scan over battle_participant - 12,000 random
-- heap pages from disk for 25,000 rows the 0100 covering index already
-- carries. The planner could not use the index alone: pg_class said
-- relallvisible = 0, not one page marked all-visible, so every row
-- needed a heap check and index-only was priced out.
--
-- How it got there: the 0091-0100 arc HOT-updated every row after the
-- last autovacuum. HOT pruning cleans the dead versions on the page as
-- it goes (dead_rows sat at 12 after 1.67M updates), so autovacuum's
-- dead-tuple trigger never fires, and only VACUUM sets the map. The
-- table then grows by ~8k participant rows a day, which reaches the
-- default insert trigger (1,000 + 20% of the table) every ~12 days.
--
-- The one-off VACUUM that rebuilds the map is the migrate Lambda's
-- {vacuum: {table}} op, run after this lands (VACUUM cannot run inside
-- a migration's transaction). This makes the fix hold: an insert-driven
-- vacuum after 2% growth (roughly daily), which only visits pages the
-- map does not already cover, and an analyze at the same pace so the
-- planner's row estimates track the week. battle gets the same: its map
-- covered 3,201 of 5,104 pages, and the join reads all of it.
alter table battle_participant set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table battle set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
