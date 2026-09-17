-- 0105: the master war calendar (schema review 1.2, plan step 4).
-- Additive, instant: one small table, one nullable column, a seed.
--
-- The API stamps nothing on a war battle beyond its type and time, and
-- the recorder tried to add what the API did not give: stampWarKeys
-- wrote season_id / section_index / war_day onto `battle` only inside
-- 14 days, only when the clan's next race poll followed, only once. On
-- the 09-16 clone 76% of war battles carried no key and 3,230 stamped
-- ones contradicted their own battle_time. A war battle's week and day
-- are a pure function of battle_time on a global grid: the week key and
-- the live periodIndex are identical for every clan at the same instant
-- (six clans in five countries, cr-agent-api-docs/clans.md), and the
-- policy grid, 10:00Z, is what this service already follows for every
-- clan (war-clock.mjs, Jamie 2026-09-07). So the calendar becomes rows
-- and the readers resolve a battle by range plus the participant's own
-- clan_tag; the stamps retire in 0106 once no reader names them.
--
-- The one per-clan fact, the race's own close instant (drawn per race
-- inside the 09:30Z-10:00Z band before the hour), is not here: it is
-- war_week.closed_at, the API's own createdDate for that clan's week.
create table war_period (
  war_season_id   integer not null references season (war_season_id),
  period_index    integer not null,
  section_index   smallint not null,
  day_in_section  smallint not null,
  kind            text not null check (kind in ('training', 'war', 'colosseum')),
  war_day         smallint check (war_day between 1 and 4),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  primary key (war_season_id, period_index),
  unique (starts_at),
  check (section_index = period_index / 7),
  check (day_in_section = period_index % 7),
  check ((kind = 'training') = (war_day is null)),
  check (ends_at = starts_at + interval '24 hours'),
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
);
comment on table war_period is
  'The policy grid, one row per river race period: days roll at 10:00Z, three training days then four war days per section, the last section of a season is colosseum. Global; a clan''s own close slot lives in war_week.closed_at and riverracelog, not here. Generated from season by services/ingest/src/season.mjs.';

alter table war_week add column closed_at timestamptz;
comment on column war_week.closed_at is
  'The API''s own createdDate for this clan''s week in riverracelog: the race close instant, exact. NULL for weeks older than the log the API still served when the column arrived (finished_observed_at is their polling-latency bound).';

-- Seed every season the record holds, from the same arithmetic
-- season.mjs runs from here on (the test pins the two equal).
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
       -- Hours, not days: a day interval follows the session's wall
       -- clock across DST, and the grid is absolute (10:00Z).
       s.starts_at + p.i * interval '24 hours',
       s.starts_at + (p.i + 1) * interval '24 hours'
from season s
cross join lateral generate_series(0, s.sections * 7 - 1) as p(i);
