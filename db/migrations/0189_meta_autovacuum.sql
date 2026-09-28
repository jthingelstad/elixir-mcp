-- 0189: keep the meta readers' tables vacuumed as they grow (2026-09-27).
--
-- 0103 set insert-driven vacuum on battle and battle_participant only.
-- The meta readers probe deck, deck_card and meta_season_pop index-only,
-- and an index-only probe of a page the visibility map does not cover
-- fetches the heap. deck.last_seen_at moves on each newer sighting, the
-- deck rollups take non-HOT hourly updates on an indexed column, and the
-- six season rollup tables are rebuilt nightly. At the default insert
-- trigger (1,000 + 20% of the table) deck_card, about 2M rows, waits for
-- about 400k inserts between vacuums: on 2026-09-26 it sat at 92%
-- all-visible in steady state (review 2026-09-27 §5.2, issue #71).
-- battle_participant_card is the card-row twin of battle_participant.
--
-- The same settings as 0103: an insert-driven vacuum after 2% growth,
-- which visits only the pages the map does not already cover, a vacuum
-- after 5% of rows change, and an analyze at 2% so the planner's
-- estimates track the week. Checked a week on with {tables}
-- (all_visible_pct above about 98 with no manual {vacuum}).
--
-- Not here: the one-off VACUUM after a backfill, which is still the
-- {vacuum: {table}} op (DECISIONS: a backfill that does not vacuum is not
-- finished).
--
-- Each ALTER takes a SHARE UPDATE EXCLUSIVE lock for an instant (it
-- conflicts with a running vacuum, not with reads or writes); fail fast
-- behind one rather than queue.

set local lock_timeout = '5s';

alter table deck set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table deck_card set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table meta_season_pop set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table battle_participant_card set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table card_meta_season set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table card_meta_season_band set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table deck_meta_season set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table deck_meta_season_band set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table meta_season_totals set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table meta_season_band_totals set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
