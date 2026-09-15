-- 0102: the arena floor, read from the snapshots. An arena's floor is
-- the trophy count below which its players cannot fall (the gate), and
-- the record already holds it: the lowest trophies any snapshot ever
-- showed in that arena, because gated players sit exactly on it. The
-- arena_changed moment reads it to name the battle whose win carried
-- the player over (ingest/snapshots.mjs, promotionBattle). Promotions
-- are a handful a day; this keeps each read off a sequential scan.
create index player_snapshot_daily_arena_trophies
  on player_snapshot_daily (arena_id, trophies)
  where arena_id is not null and trophies is not null;
