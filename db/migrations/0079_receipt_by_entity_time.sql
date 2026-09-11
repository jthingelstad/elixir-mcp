-- 0079: receipts by subject over a window (Jamie, 2026-09-11: the
-- console rail lagged the page by two seconds on every load).
--
-- GET /api/me carries, for each recording the account tracks, how many
-- receipts the last day holds for that subject. The only index with
-- entity_key in it leads on endpoint, which that read does not name,
-- so each recording walked the whole day's receipts by fetched_at and
-- checked the tag on every row - a dozen recordings, a dozen walks,
-- on every page of the console. This index answers it as one range.
create index api_receipt_entity_time
  on api_receipt (entity_key, fetched_at desc);
