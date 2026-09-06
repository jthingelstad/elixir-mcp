-- 0038: snapshot out-of-order guard (sol-6 finding 7).
--
-- Daily snapshots overwrote unconditionally, so a delayed or replayed
-- OLDER observation could regress the day's values. Snapshots now
-- carry the observation time and only a newer-or-equal observation may
-- overwrite. Existing rows stay null (unknown when observed) - the
-- first post-deploy poll stamps them.

alter table player_snapshot_daily add column observed_at timestamptz;
