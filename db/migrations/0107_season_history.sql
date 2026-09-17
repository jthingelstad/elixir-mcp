-- 0107: the season calendar reaches back to the ranked ladder's first
-- season (schema review plan step 9, the FK half). ranking_snapshot's
-- finals are filed under the API's month since 0070 and go back to
-- 2022-10 (position 97 in /locations/global/seasons, the earliest with a
-- board); once season_month references season, those rows need their
-- calendar rows. The same first-Monday arithmetic as 0104 (the months
-- have been one season each since 2017-04) and the same war number
-- (2022-10 = 89, as game_clock counts it), with the periods of 0105.
with months as (
  select generate_series(date '2022-10-01', date '2026-02-01', interval '1 month')::date as m
), starts as (
  select m,
         ((m + ((8 - extract(dow from m)::int) % 7))::timestamp + interval '10 hours')
           at time zone 'UTC' as starts_at
  from months
), bounded as (
  select m, starts_at, lead(starts_at) over (order by m) as ends_at from starts
)
insert into season (season_month, war_season_id, starts_at, ends_at, sections, colosseum_section)
select to_char(m, 'YYYY-MM'),
       135 + (extract(year from m)::int - 2026) * 12 + (extract(month from m)::int - 8),
       starts_at,
       ends_at,
       (extract(epoch from ends_at - starts_at) / 604800)::int,
       (extract(epoch from ends_at - starts_at) / 604800)::int - 1
from bounded
where ends_at is not null
on conflict (season_month) do nothing;

insert into war_period
  (war_season_id, period_index, section_index, day_in_section, kind, war_day, starts_at, ends_at)
select s.war_season_id,
       p.i,
       p.i / 7,
       p.i % 7,
       case when p.i % 7 < 3 then 'training'
            when p.i / 7 = s.colosseum_section then 'colosseum'
            else 'war' end,
       case when p.i % 7 < 3 then null else p.i % 7 - 2 end,
       s.starts_at + p.i * interval '24 hours',
       s.starts_at + (p.i + 1) * interval '24 hours'
from season s
cross join lateral generate_series(0, s.sections * 7 - 1) as p(i)
where not exists (select 1 from war_period w where w.war_season_id = s.war_season_id);
