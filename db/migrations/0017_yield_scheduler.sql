-- 0017: the yield scheduler's signals (NOTES: budget-efficiency
-- redesign, Jamie GO 2026-09-04). Two small columns on poll_state:
--
--   yield_bph  — EWMA of battles-per-hour observed for this subject's
--                battlelog endpoint (updated at admission; the single
--                activity signal that drives battlelog AND profile
--                cadence in yield mode).
--   hint       — endpoint-specific cadence hint; for currentriverrace
--                the last observed periodType (warDay/training/...),
--                because the payload TELLS us war days — no inference.
alter table poll_state add column yield_bph numeric;
alter table poll_state add column hint text;
