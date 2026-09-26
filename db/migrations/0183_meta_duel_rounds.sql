-- 0183: the season rollups count duel rounds as games, and say how many.
--
-- Feedback #363, step two (Jamie's go, 2026-09-26): with each round's deck
-- and result recorded (0182), the rollup reads a duel as its rounds (the
-- contracts' duelGamesSql), so a war deck's record holds its duel games
-- beside its 1v1 battles. duel_rounds is how many of a row's battles were
-- duel rounds, which is the 1v1 and duel split the feedback asked for,
-- without a new mode group; on meta_season_totals, how many of the
-- decided were.
--
-- Nullable, no default: catalog-only on every table. Null until the
-- season's next rebuild (the hourly adds onto it, and null + n stays
-- null, as level_gap_sum does), so a reader never serves a split that
-- covers a few hours as the season's.

set local lock_timeout = '5s';

alter table deck_meta_season add column duel_rounds integer;
alter table card_meta_season add column duel_rounds integer;
alter table deck_meta_season_band add column duel_rounds integer;
alter table card_meta_season_band add column duel_rounds integer;
alter table meta_season_totals add column duel_rounds integer;

comment on column deck_meta_season.duel_rounds is
  'Of battles, how many were duel rounds (0183): each round of a riverRaceDuel is its own game with its own deck and result. Null until the season''s next rebuild.';
comment on column card_meta_season.duel_rounds is
  'Of battles, how many were duel rounds (0183). Null until the season''s next rebuild.';
comment on column deck_meta_season_band.duel_rounds is
  'As deck_meta_season.duel_rounds, within the trophy band.';
comment on column card_meta_season_band.duel_rounds is
  'As card_meta_season.duel_rounds, within the trophy band.';
comment on column meta_season_totals.duel_rounds is
  'Of decided, how many were duel rounds (0183). Null until the season''s next rebuild.';
