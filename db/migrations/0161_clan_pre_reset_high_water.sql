-- 0161: the clan's pre_reset row holds the week's donation high-water.
--
-- 0159 raised the members' pre_reset rows to their game-week maximum; the
-- clan's own row (clan_snapshot_daily.donations_per_week) was left as it
-- was read. Its pre_reset reads for the weeks of game days 2026-09-06 and
-- 09-13 landed at 00:07Z and 00:03Z Monday, after the weekly reset, and
-- held the new week's 10 where the clan's daily counter had reached 9,270
-- and 9,094 (feedback #195). The counter only climbs until the reset, so
-- the week's donations are the highest value the record saw (Jamie,
-- 2026-09-23). Ingest now keeps that; this raises the stored rows.
--
-- One row per clan per week, resolved through the primary key
-- (clan_tag, day, snapshot_kind); no table is rewritten.

set local lock_timeout = '5s';

update clan_snapshot_daily pr
   set donations_per_week = w.donations_per_week
  from (
    select r.clan_tag, r.day, max(s.donations_per_week) as donations_per_week
      from clan_snapshot_daily r
      join clan_snapshot_daily s
        on s.clan_tag = r.clan_tag
       and s.day between date_trunc('week', r.day)::date and r.day
       and s.snapshot_kind in ('daily', 'pre_reset')
     where r.snapshot_kind = 'pre_reset'
     group by r.clan_tag, r.day) w
 where pr.clan_tag = w.clan_tag
   and pr.day = w.day
   and pr.snapshot_kind = 'pre_reset'
   and pr.donations_per_week is distinct from greatest(pr.donations_per_week, w.donations_per_week);
