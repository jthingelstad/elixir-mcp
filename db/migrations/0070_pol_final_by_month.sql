-- The finals were labelled by the wrong season number (found 2026-09-11).
--
-- 0069 backfilled /locations/global/pathoflegend/{season}/rankings/players
-- with numeric season ids 97..135, taking the number for the ordinal the
-- game clock counts (S136 = September 2026). It is not: a numeric id there
-- is the 1-based POSITION in the API's own /locations/global/seasons list,
-- which starts at 2016-02 and carries duplicate early entries, so position
-- 136 is 2026-01 and position 143 is the latest final, 2026-08. Verified by
-- matching #1 players across the two forms (135 = 2025-12, 97 = 2022-10).
-- The clan-war season running on the day was also numbered 136, which is
-- what made the numeric form look like the ordinal; a coincidence.
--
-- So the thirty-nine finals held as S97..S135 are the 2022-10..2025-12
-- finals, which the game clock counts as S89..S127, and the eight finals
-- since (2026-01..2026-08, S128..S135) were never fetched. The fix:
--
--   * A final is fetched by the API's own name for it, `YYYY-MM`, which is
--     unambiguous; the planner seeds one poll_state row per settled month.
--   * The snapshot keeps season_id in the game clock's namespace, the one
--     every other season fact in this database uses, and records the API's
--     month beside it as season_month.
--   * The rows already held are relabelled in place - the list has been
--     strictly monthly since position 97, so the correction is arithmetic -
--     rather than fetched again: thirty-nine boards of 9,999 places whose
--     content was never wrong, only their names.

alter table ranking_snapshot add column season_month text;
comment on column ranking_snapshot.season_month is
  'For a pol_final snapshot: the API''s own name for the season, YYYY-MM of the month it started in. season_id is the same season as the game clock counts it.';

-- Relabel: position p in the API list is the month p-97 months after
-- 2022-10, and the game clock counts that month as season p-8.
update ranking_snapshot
   set season_month = to_char(date '2022-10-01' + ((season_id::int - 97) * interval '1 month'), 'YYYY-MM'),
       season_id    = (season_id::int - 8)::text
 where board = 'pol_final'
   and season_month is null
   and season_id ~ '^[0-9]+$'
   and season_id::int >= 97;

create index ranking_snapshot_final_month
  on ranking_snapshot (season_month) where board = 'pol_final';

-- The numeric poll_state rows are wanted no more; the planner seeds the
-- month-keyed ones on its next tick and fetches whichever are not held.
delete from poll_state
 where endpoint = 'rankings_pol_season'
   and subject_tag !~ '^[0-9]{4}-[0-9]{2}$';
