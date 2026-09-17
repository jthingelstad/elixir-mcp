-- 0104: the season becomes a row (docs/reviews/2026-09-16-SCHEMA-REVIEW.md
-- 1.1, plan step 1). Additive, instant: two small tables and a seed.
--
-- The game runs on a calendar the schema held nowhere. The API names a
-- season by the month it starts in (YYYY-MM: the seasons list,
-- leagueStatistics, the Path of Legends finals, the progress keys), and
-- every other number is a derived label for that same monthly season.
-- The river race seasonId is one such label - one per month, checked at
-- six points against our own war history (2025-03 = 118 .. 2026-09 = 136)
-- - and it is DERIVED here, then confirmed by each riverracelog entry the
-- record admits (war_id_verified_at). A mismatch is an alarm
-- (ElixirMCP/Record SeasonWarIdMismatch), never a relabel.
--
-- Bounds are the calendar: first Monday of the month 10:00Z to the next
-- first Monday 10:00Z, the same policy hour the period grid uses (Jamie,
-- 2026-09-07, from the game's own countdown). No column is observed: the
-- per-race close instant is one clan's observation and lives on
-- war_week (0105). There is no Pass season and no balance-change model:
-- the Pass number and name are not in the API, and nothing hand-fed or
-- scraped enters the data layer. The season IS the grouping that honours
-- balance changes, because Supercell ships them on the season roll.
create table season (
  season_month        text primary key
                      check (season_month ~ '^[0-9]{4}-[0-9]{2}$'),
  war_season_id       integer not null unique,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  sections            smallint not null check (sections in (4, 5)),
  colosseum_section   smallint not null,
  war_id_verified_at  timestamptz,
  check (ends_at > starts_at),
  check (colosseum_section = sections - 1),
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
);
comment on table season is
  'One row per Clash Royale season, keyed by the month the API names it (YYYY-MM). war_season_id is the riverrace seasonId, a derived label confirmed by the next war log entry (war_id_verified_at); a mismatch alarms. Bounds are the calendar: first Monday 10:00Z to first Monday 10:00Z. The Pass season (number and name) is not in the API and is not modelled.';
comment on column season.war_id_verified_at is
  'When a riverracelog entry inside these bounds first carried this war_season_id. NULL = derived only, not yet confirmed by the API.';

-- A mode's own season key, taken verbatim from Player.progress and never
-- derived: Merge Tactics counts its own (AutoChess_2026_Season_11), the
-- 2v2 League and the seasonal Trophy Road use the month. first/last seen
-- are the observation (the profile projector upserts them).
create table mode_season (
  progress_key   text primary key,
  mode           text not null,
  season_month   text references season,
  first_seen_at  timestamptz not null,
  last_seen_at   timestamptz not null
);
comment on table mode_season is
  'Side-mode season keys as Player.progress spells them; mode is the key with its season part removed; season_month is set when the key carries YYYYMM (2v2League_202609, seasonal-trophy-road-202609) and null when the mode counts its own (AutoChess_2026_Season_11).';

-- Seed 2026-02 .. 2026-10 (war 129 .. 137) from the same arithmetic
-- services/ingest/src/war-clock.mjs runs (the test pins the two equal):
-- the first Monday of the month at 10:00Z; the war id counts months from
-- the 2026-08 = 135 anchor. From here the scheduler keeps the current
-- and next season present on every tick (services/ingest/src/season.mjs).
with months as (
  select generate_series(date '2026-02-01', date '2026-11-01', interval '1 month')::date as m
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
where ends_at is not null;
