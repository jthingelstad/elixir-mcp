-- 0143: the planner asks, per poll subject, when the API last said 404
-- (plan.mjs NOT_FOUND_BACKOFF_MINUTES, 2026-09-19). The table keeps
-- seven days and is small; the index keeps the per-row lookup off a
-- sequential scan as the fleet grows.
create index collector_fetch_error_subject
  on collector_fetch_error (endpoint, entity_key, fetched_at desc)
  where http_status = 404;
