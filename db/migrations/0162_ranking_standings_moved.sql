-- 0162: standings_changed_at moves only when the standings moved.
--
-- 0158 stamped a mode board's standings_changed_at whenever the
-- (rank, player_tag, rating) hash changed. A player leaving the board
-- shifts every rank below them and pulls the next player in at #1000,
-- below the old floor, with no rating changed anywhere. So closed boards
-- read as moving (board 270787 closed but stamped today; 2v2 League
-- "moved" on 09-20 by departures alone; feedback #208). A snapshot now
-- counts as moved when a player on both reads changed rating, or a
-- newcomer entered at or above the previous board's floor. Ingest applies
-- the same rule from this deploy; this recomputes the mode boards' stamps,
-- the few hundred rows 0158 backfilled. ranking_entry is read by its
-- primary key and never rewritten.

set local lock_timeout = '5s';

with s as (
  select snapshot_id, location_key, observed_at,
         lag(snapshot_id) over (partition by location_key order by observed_at) as prev_id
    from ranking_snapshot
   where board = 'mode'
), m as (
  select s.*,
         s.prev_id is null
         or exists (
              select 1 from ranking_entry e
                join ranking_entry p on p.snapshot_id = s.prev_id and p.player_tag = e.player_tag
               where e.snapshot_id = s.snapshot_id
                 and e.rating is distinct from p.rating)
         or exists (
              select 1 from ranking_entry e
               where e.snapshot_id = s.snapshot_id
                 and not exists (select 1 from ranking_entry p
                                  where p.snapshot_id = s.prev_id and p.player_tag = e.player_tag)
                 and coalesce(e.rating, -2147483648) >=
                     coalesce((select min(p.rating) from ranking_entry p where p.snapshot_id = s.prev_id), -2147483648)) as moved
    from s
), runs as (
  select m.*,
         max(case when moved then observed_at end)
           over (partition by location_key order by observed_at) as changed_at
    from m
)
update ranking_snapshot t
   set standings_changed_at = r.changed_at
  from runs r
 where t.snapshot_id = r.snapshot_id
   and t.standings_changed_at is distinct from r.changed_at;
