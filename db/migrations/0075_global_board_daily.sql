-- The global Path of Legends board is recorded daily, not hourly
-- (Jamie, 2026-09-11: "we got a little crazy with the global
-- leaderboard" - snapshot it once a day at the reset; the golden board
-- is the season's final, fetched once from the API's own finals path).
--
-- Hourly was 24 snapshots x 1,000 rows a day: ranking_entry grew ~5 MB
-- a day from one board regardless of how many players were recorded,
-- and every snapshot touched 1,000 player rows for last_seen_at. The
-- planner anchors every daily board to 10:00Z (plan.mjs), so the last
-- daily snapshot of a season is the board as it stood going into the
-- roll; nothing else in the row changes.

update ranking_board set every_minutes = 1440
 where board = 'pol' and location_key = 'global' and every_minutes < 1440;
