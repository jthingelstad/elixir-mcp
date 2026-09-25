-- 0176: the battle-log rebuild of race-week days leaves the record.
--
-- 0168 let war_attendance_day carry rows rebuilt from recorded river-race
-- battles (source 'battlelog', written by the migrate op
-- {training_backfill}, about 726 rows): a floor on a member's decks for a
-- day, guessed from what their log happened to capture. Jamie,
-- 2026-09-25: war facts are weekly aggregates only, and the per-day guess
-- is retired with the op that wrote it. The game's own poll rows (source
-- 'poll', decksUsedToday) stay. A small table and a plain delete; the
-- lock timeout fails the deploy fast rather than letting it queue behind
-- an in-flight race-poll upsert.

set local lock_timeout = '5s';

delete from war_attendance_day where source = 'battlelog';

comment on table war_attendance_day is
  'Per member, per day of a race week (day_in_section 0-6: three training days, then four war days): the highest decksUsedToday a race poll saw that day. The same four war decks all week; only war-day decks score. war_day is derived: 1-4 on war days, null on training days. source is poll on every row since 0176 (the battlelog rebuild of 0168 was retired 2026-09-25).';
