-- 0165: a week's clan_score is the clan's war trophies going INTO the race.
--
-- The live race poll stores the going-in figure. When no live poll saw a
-- week, the race log filled the column, and the log's clanScore is the
-- figure AFTER the race. So those rows read one trophy_change high: in the
-- Colosseum weeks 132/3 and 133/4, 10 of 10 rows equal the previous
-- week's going-in figure plus its change plus their own change (feedback
-- #224). Ingest now subtracts the week's trophy_change from the log's
-- figure; this repairs the stored rows that show that exact chain, where
-- the previous week is the same season's previous section and the change
-- is not zero, so no row is touched on a guess.

set local lock_timeout = '5s';

with w as (
  select c.clan_tag, c.season_id, c.section_index, c.participant_clan_tag,
         c.clan_score, c.trophy_change,
         p.clan_score as prev_score, p.trophy_change as prev_change
    from war_week_clan c
    join war_week_clan p
      on p.clan_tag = c.clan_tag and p.participant_clan_tag = c.participant_clan_tag
     and p.season_id = c.season_id and p.section_index = c.section_index - 1
   where c.trophy_change is not null and c.trophy_change <> 0
     and c.clan_score is not null and p.clan_score is not null and p.trophy_change is not null
)
update war_week_clan t
   set clan_score = t.clan_score - w.trophy_change
  from w
 where t.clan_tag = w.clan_tag and t.season_id = w.season_id
   and t.section_index = w.section_index and t.participant_clan_tag = w.participant_clan_tag
   and w.clan_score = w.prev_score + w.prev_change + w.trophy_change;
