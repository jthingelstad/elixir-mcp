-- 0163: a newcomer tied at the previous floor is a fill, not a move.
--
-- 0162 counted a newcomer at or above the previous board's floor as a
-- move. On boards whose floor is a tie (board 270787: dozens of players
-- at rating 23), each departure pulls in the next player at that same
-- rating, and the board read as moving today (feedback #208, the gate's
-- 208.1). The rule is now strictly above the floor, in ingest and here;
-- the recompute is otherwise 0162's, over the mode boards' few hundred
-- snapshot rows.

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
                 and coalesce(e.rating, -2147483648) >
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
