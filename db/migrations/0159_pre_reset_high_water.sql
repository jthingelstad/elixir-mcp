-- 0159: the pre_reset row holds the week's high-water mark.
--
-- The weekly donation counters only climb until the weekly reset, then
-- drop to 0. So a week's donations are the highest value the record saw
-- (Jamie, 2026-09-23). This is deliberately not a guess at the reset's
-- minute, which a poll schedule cannot pin down.
--
-- Until now the pre_reset row took each read in its window as it came.
-- A read after the reset replaced the week with the new week's zeros:
-- the weeks of game days 2026-09-06 and 09-13 summed to 10 across a
-- whole clan (feedback #158). Ingest now keeps the greater value. This
-- raises every stored pre_reset row to the highest donations and
-- donations_received its player's rows show over that game-day week
-- (Monday to Sunday game days). Where the reset had wiped the row, the
-- week's best-known value is the last daily read before it, not 0.
--
-- A few thousand pre_reset rows, each resolved through the primary key
-- (player_tag, snapshot_date, snapshot_kind); no table is rewritten.

set local lock_timeout = '5s';

update player_snapshot_daily pr
   set donations = w.donations,
       donations_received = w.donations_received
  from (
    select r.player_tag, r.snapshot_date,
           max(s.donations) as donations,
           max(s.donations_received) as donations_received
      from player_snapshot_daily r
      join player_snapshot_daily s
        on s.player_tag = r.player_tag
       and s.snapshot_date between date_trunc('week', r.snapshot_date)::date and r.snapshot_date
       and s.snapshot_kind in ('daily', 'pre_reset')
     where r.snapshot_kind = 'pre_reset'
     group by r.player_tag, r.snapshot_date) w
 where pr.player_tag = w.player_tag
   and pr.snapshot_date = w.snapshot_date
   and pr.snapshot_kind = 'pre_reset'
   and (pr.donations is distinct from greatest(pr.donations, w.donations)
        or pr.donations_received is distinct from greatest(pr.donations_received, w.donations_received));
