-- 0130: two ledgers the race and profile payloads carried on every poll
-- and the record never kept (time-series review 2.1, 2.3, 4.4).
--
-- player_pol_season: lastPathOfLegendSeasonResult, the previous
-- season's final standing, carried on every profile poll of the
-- following month. Fill-once per (player, season): the season is the
-- latest whose ends_at is at or before the poll. The archive holds
-- every recorded player's final for every season since March, which is
-- what makes elixir-bot's pol_season_results a check, not an import.
create table player_pol_season (
  player_tag    text not null references player,
  season_month  text not null references season,
  league        integer,
  trophies      integer,
  rank          integer,
  observed_at   timestamptz not null,
  primary key (player_tag, season_month)
);
comment on table player_pol_season is
  'A player''s final Path of Legends standing for a season (the API''s lastPathOfLegendSeasonResult, read in the following month), written once. league/trophies/rank as the API spells them; rank null unless globally ranked.';

-- war_period_log: currentriverrace.periodLogs[], the race's day-by-day
-- results per participating clan, present on every race poll for the
-- whole section. Fill-once per closed day, scoped to the section the
-- poll is in (period_index / 7 = section_index); an older poll cannot
-- rewrite a day.
create table war_period_log (
  clan_tag               text not null,
  season_id              integer not null,
  section_index          integer not null,
  period_index           integer not null,
  participant_clan_tag   text not null,
  points_earned          integer,
  progress_start         integer,
  progress_end           integer,
  progress_earned        integer,
  end_of_day_rank        smallint,
  defenses_remaining     smallint,
  progress_from_defenses integer,
  observed_at            timestamptz not null,
  primary key (clan_tag, season_id, section_index, period_index, participant_clan_tag),
  foreign key (clan_tag, season_id, section_index)
    references war_week (clan_tag, season_id, section_index)
);
comment on table war_period_log is
  'periodLogs[] of the observing clan''s current river race: one row per closed war day per clan in the race, filled once from the first poll that carried it. period_index is the season-monotonic index the API speaks; the war day is war_period.';

-- The rivals' columns the race poll and the log carry beside fame:
-- clanScore (state, latest under the observed_at guard), repairPoints
-- (MAX-merged like every war counter), badgeId onto the clan row.
alter table war_week_clan
  add column clan_score    integer,
  add column repair_points integer;
alter table war_participation
  add column repair_points integer;
