-- 0174: the players who played a deck more than once, beside those who
-- played it at all.
--
-- min_players 2 let one player's deck through as "3 players, 57-2": one
-- player went 57-0 and two others played it once each (Gym #348). From
-- 8.0.0 min_players counts repeat players, two or more battles on the
-- deck (Jamie, 2026-09-24); players stays the distinct count. Written by
-- the nightly with players (null until a season's next rebuild).

alter table deck_meta_season add column repeat_players integer;
alter table deck_meta_season_band add column repeat_players integer;

comment on column deck_meta_season.repeat_players is
  'Distinct players with two or more decided battles on the deck in the season and mode group (8.0.0, Gym #348); nightly, null before the first rebuild.';
comment on column deck_meta_season_band.repeat_players is
  'As deck_meta_season.repeat_players, within the trophy band.';
