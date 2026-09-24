-- 0166: a seasonal Trophy Road row at bestTrophies 0 is not progress.
--
-- The profile reports the seasonal Trophy Road's ENTRY value (trophies
-- 14000, bestTrophies 0) to every player who never climbed it, so 30 of
-- 30 POAP KINGS members below 14,000 read as standing at 14,000 on it
-- (feedback #229). Ingest now writes no row for such a bucket, the same
-- "no record for no activity" rule as a bucket at 0/0; this removes the
-- stored ones. They are a projection of profile payloads the archive
-- keeps, so nothing observed is lost.

set local lock_timeout = '5s';

delete from player_progress_daily p
 using mode_season m
 where m.progress_key = p.progress_key
   and m.mode = 'seasonal-trophy-road'
   and coalesce(p.best_trophies, 0) = 0;
