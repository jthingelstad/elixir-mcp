-- 0169: one row per member per day of the race WEEK, training days included.
--
-- Jamie 2026-09-24: training and war days are the same four war decks;
-- the only difference is that a war day's decks score, and each can be
-- played once. Members use training days to get reps in with them. A
-- separate training table (0167) kept an elixir-bot framing, so this folds
-- it back: war_attendance_day is keyed by day_in_section (0-6, the policy
-- grid's day of the week, as war_period has it) and war_day becomes
-- derived, 1-4 on war days and null on training days, so every war-day
-- reader keeps its meaning. source (0168) comes along.
--
-- The deploy's flip window: the old ingest names war_day and war_training_day
-- for a minute or two after this runs; those writes fail and the next poll
-- (cumulative decksUsedToday) carries them. war_training_day is emptied into
-- this table here and dropped by the next migration.

set local lock_timeout = '5s';

alter table war_attendance_day
  add column day_in_section smallint,
  add column source text not null default 'poll'
    check (source in ('poll', 'battlelog'));

update war_attendance_day set day_in_section = war_day + 2;

alter table war_attendance_day
  drop constraint war_attendance_day_pkey,
  drop column war_day,
  alter column day_in_section set not null,
  add constraint war_attendance_day_day_check check (day_in_section between 0 and 6),
  add column war_day smallint generated always as (
    case when day_in_section >= 3 then day_in_section - 2 end) stored,
  add primary key (clan_tag, season_id, section_index, day_in_section, player_tag);

insert into war_attendance_day
  (clan_tag, season_id, section_index, day_in_section, player_tag,
   decks_used_today, source)
select clan_tag, season_id, section_index, training_day - 1, player_tag,
       decks_used_today, source
  from war_training_day
on conflict do nothing;

comment on table war_attendance_day is
  'Per member, per day of a race week (day_in_section 0-6: three training days, then four war days): the highest decksUsedToday a race poll saw that day (source poll), or the day rebuilt from recorded river-race battles (source battlelog). The same four war decks all week; only war-day decks score. war_day is derived: 1-4 on war days, null on training days.';
