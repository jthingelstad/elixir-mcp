-- 0135: the meta rollups gain the two controls the 3.13.0 principle
-- names for a corpus meta row, and the trophy band as a dimension
-- (interface review 2026-09-19 Part 4, product call 1: option A).
--
-- Additive and instant, the 0099 rule: nullable columns with no default
-- on the two rollup tables, and three EMPTY companion tables keyed by
-- the band. A band cannot be a nullable column inside the existing
-- primary keys and re-keying a 150 MB rollup is the rewrite the rule
-- forbids, so the banded rows live beside the unbanded ones under their
-- own key. Nothing is filled here: the nightly job
-- (services/jobs/src/meta-rollup.mjs) fills the level-gap columns and
-- the band tables on its next rebuild of the running season and refills
-- ended seasons within its budget; the hourly increment adds onto the
-- band tables only once a rebuild has filled them (bands_rebuilt_at),
-- so a banded read never sees a few hours' rows as a season. Until
-- then a banded read falls back to the raw path and says so.
--
-- The band is the participant's OWN starting trophies at battle time,
-- the five bands battles_levels speaks: under_5000, 5000_8000,
-- 8000_11000, 11000_13000, 13000_plus. A participant with no starting
-- trophies (war, casual) is in the unbanded rows only.
--
-- level_gap_sum / level_gap_battles: the sum over decided battles of
-- (this side's deck-average level minus the opposing side's) and the
-- count of battles where both were known, so a reader serves the mean
-- gap the raw path computes with a lateral avg (battles_decks, 3.13.0).

alter table deck_meta_season
  add column level_gap_sum     numeric,
  add column level_gap_battles integer;
alter table card_meta_season
  add column level_gap_sum     numeric,
  add column level_gap_battles integer;
alter table meta_season_state
  add column bands_rebuilt_at timestamptz;
comment on column meta_season_state.bands_rebuilt_at is
  'When the nightly rebuild last filled the *_band tables and the level-gap columns for this season; null until it has, and the hourly increment leaves the band tables alone until then.';

create table meta_season_band_totals (
  season_month  text not null references season,
  mode_group    text not null check (mode_group in ('all', 'ladder', 'ranked', 'casual', 'war', 'challenge', 'tournament')),
  trophy_band   text not null check (trophy_band in ('under_5000', '5000_8000', '8000_11000', '11000_13000', '13000_plus')),
  decided       integer not null default 0,
  wins          integer not null default 0,
  primary key (season_month, mode_group, trophy_band)
);

create table deck_meta_season_band (
  season_month      text not null references season,
  mode_group        text not null check (mode_group in ('all', 'ladder', 'ranked', 'casual', 'war', 'challenge', 'tournament')),
  trophy_band       text not null check (trophy_band in ('under_5000', '5000_8000', '8000_11000', '11000_13000', '13000_plus')),
  deck_hash         text not null references deck (deck_hash),
  battles           integer not null default 0,
  wins              integer not null default 0,
  losses            integer not null default 0,
  players           integer,
  level_gap_sum     numeric,
  level_gap_battles integer,
  first_used        timestamptz not null,
  last_used         timestamptz not null,
  primary key (season_month, mode_group, trophy_band, deck_hash)
);
create index deck_meta_season_band_battles
  on deck_meta_season_band (season_month, mode_group, trophy_band, battles desc);

create table card_meta_season_band (
  season_month      text not null references season,
  mode_group        text not null check (mode_group in ('all', 'ladder', 'ranked', 'casual', 'war', 'challenge', 'tournament')),
  trophy_band       text not null check (trophy_band in ('under_5000', '5000_8000', '8000_11000', '11000_13000', '13000_plus')),
  card_id           integer not null references card (card_id),
  form              smallint not null check (form between -1 and 3),
  battles           integer not null default 0,
  wins              integer not null default 0,
  losses            integer not null default 0,
  players           integer,
  level_gap_sum     numeric,
  level_gap_battles integer,
  primary key (season_month, mode_group, trophy_band, card_id, form)
);
comment on table deck_meta_season_band is
  'deck_meta_season by the participant''s own trophy band at battle time (0135): the meta at a level. Filled by the nightly rebuild; incremented hourly once filled.';
comment on table card_meta_season_band is
  'card_meta_season by the participant''s own trophy band at battle time (0135). Filled by the nightly rebuild; incremented hourly once filled.';
