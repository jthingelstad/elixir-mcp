-- 0167: decks members play on a race week's TRAINING days.
--
-- The race poll carries decksUsedToday on every day of the week, training
-- days included, but ingest kept it only on war days (an elixir-bot
-- holdover: training battles do not score). Jamie 2026-09-24: record them
-- too. A table of their own, so war_attendance_day keeps meaning war days
-- and no war-day reader changes. training_day is 1..3 (period index mod 7
-- plus one); Colosseum's practice days are training days here as well.

create table war_training_day (
  clan_tag         text not null references clan,
  season_id        integer not null,
  section_index    integer not null,
  training_day     integer not null check (training_day between 1 and 3),
  player_tag       text not null references player,
  decks_used_today integer not null default 0,
  observed_at      timestamptz not null default now(),
  primary key (clan_tag, season_id, section_index, training_day, player_tag)
);

comment on table war_training_day is
  'Per member, per race-week training day: the highest decksUsedToday a race poll saw that day. Training battles do not score; war_attendance_day holds war days. Recorded from 2026-09-24.';
