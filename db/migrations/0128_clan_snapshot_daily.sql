-- 0128: clan_snapshot_daily (time-series review 4.1): one row per clan
-- per game day, written by the roster projector for every admitted
-- roster (an incidental clan's row is one poll it already made; the
-- branch on who is tracking would be the first thing keyed on it).
-- The primary key is the only index: the timeline read is a range on it.
-- receipt_id is provenance for the backfill (one bigint a day).
-- clan_daily_metrics (0001) was never written and was dropped in 0094;
-- this is not it brought back: the columns are the roster's own.
create table clan_snapshot_daily (
  clan_tag           text not null references clan,
  day                date not null,
  snapshot_kind      text not null default 'daily'
                     check (snapshot_kind in ('daily', 'pre_reset', 'season_roll')),
  observed_at        timestamptz not null,
  receipt_id         bigint references api_receipt,
  source             text not null default 'api' check (source in ('api', 'elixir-bot')),
  clan_score         integer,
  clan_war_trophies  integer,
  members            smallint,
  required_trophies  integer,
  donations_per_week integer,
  type               text,
  location_id        integer,
  primary key (clan_tag, day, snapshot_kind)
);
comment on table clan_snapshot_daily is
  'The clan series: one row per clan per game day (game_day(), 10:00Z grid) from the roster payload, last observation of the day wins under the observed_at guard; pre_reset is the row from the hour before the Monday 00:10Z donation reset, season_roll the hour before the season rolls. Every polled clan, every admitted roster.';
