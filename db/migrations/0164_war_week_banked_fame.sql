-- 0164: a finished regular week's fame is the banked progress, not the
-- race log's capped 10,000.
--
-- The race log caps a finished boat's fame (and the finishing day's
-- progressEndOfDay) at exactly 10,000; the day's own parts carry the real
-- figure. A week known from the log alone read 10,000: 130/0 against
-- 13,244 banked, 132/0 against 13,124, and POAP KINGS' 136/0 and 136/1
-- against 10,134 and 10,146 (feedback #214, #223). Ingest now raises such
-- a standing from its day logs; this repairs the stored standings and the
-- week_resolved ledger rows that copied the capped figure. Colosseum
-- weeks are not boat progress and are left alone.
--
-- Rows touched: standings exactly at 10,000 in regular weeks with a day
-- log past it, and their week_resolved events. Both small; no table is
-- rewritten.

set local lock_timeout = '5s';

with b as (
  select l.clan_tag, l.season_id, l.section_index, l.participant_clan_tag,
         max(case when l.progress_end = 10000
                   and l.progress_start + l.progress_earned + l.progress_from_defenses > 10000
                  then l.progress_start + l.progress_earned + l.progress_from_defenses
                  else l.progress_end end) as banked
    from war_period_log l
   group by 1, 2, 3, 4
)
update war_week_clan w
   set fame = b.banked
  from b, war_week ww
 where w.clan_tag = b.clan_tag and w.season_id = b.season_id
   and w.section_index = b.section_index
   and w.participant_clan_tag = b.participant_clan_tag
   and ww.clan_tag = w.clan_tag and ww.season_id = w.season_id
   and ww.section_index = w.section_index and not ww.is_colosseum
   and w.fame = 10000 and b.banked > 10000;

update clan_event e
   set fame = w.fame
  from war_week_clan w, war_week ww
 where e.event_type = 'week_resolved'
   and w.clan_tag = e.clan_tag
   and w.participant_clan_tag = e.clan_tag
   and w.season_id = e.war_season_id
   and w.section_index = e.section_index
   and ww.clan_tag = w.clan_tag and ww.season_id = w.season_id
   and ww.section_index = w.section_index and not ww.is_colosseum
   and e.fame = 10000
   and w.fame > 10000;
