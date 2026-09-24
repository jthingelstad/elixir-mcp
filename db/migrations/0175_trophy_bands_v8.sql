-- 0175: three trophy bands, matched to where the recorded data lives.
--
-- Jamie, 2026-09-24: under_10000, 10000_13999 and trophy_road_complete
-- (14,000 is Trophy Road's cap: "people that have won trophy road", not
-- a range). The five bands of 0135 split thin data finer than it holds
-- (60 days: 626 battles under 5,000; one deck under 10,000 with two
-- repeat players) and mixed finished players with climbers at 13,000+.
--
-- No big table is rewritten here. The checks accept the new names from
-- now on (NOT VALID: older seasons' rows keep the old names, and no
-- reader asks for them); every season's bands read as not yet rebuilt,
-- so a band read answers from the raw rows with the new boundaries until
-- meta_rollup_season {reset: true} rebuilds a season's population and
-- bands.

alter table meta_season_band_totals drop constraint meta_season_band_totals_trophy_band_check;
alter table deck_meta_season_band drop constraint deck_meta_season_band_trophy_band_check;
alter table card_meta_season_band drop constraint card_meta_season_band_trophy_band_check;
alter table meta_season_pop drop constraint meta_season_pop_trophy_band_check;

alter table meta_season_band_totals add constraint meta_season_band_totals_trophy_band_check
  check (trophy_band in ('under_10000', '10000_13999', 'trophy_road_complete')) not valid;
alter table deck_meta_season_band add constraint deck_meta_season_band_trophy_band_check
  check (trophy_band in ('under_10000', '10000_13999', 'trophy_road_complete')) not valid;
alter table card_meta_season_band add constraint card_meta_season_band_trophy_band_check
  check (trophy_band in ('under_10000', '10000_13999', 'trophy_road_complete')) not valid;
alter table meta_season_pop add constraint meta_season_pop_trophy_band_check
  check (trophy_band in ('under_10000', '10000_13999', 'trophy_road_complete')) not valid;

update meta_season_state set bands_rebuilt_at = null;
