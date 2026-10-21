-- 0231: The public stats snapshot keeps its own bookkeeping beside the payload.
-- The hourly refresh recounted every day of the fetch series from all of
-- api_receipt (platform review 2026-10-21 §3: 186 runs over a second in a
-- week, p50 1.7 s, about 18,000 blocks from disk each). It now recounts only
-- the days new receipts reached, and needs to remember which receipts it
-- has seen. That record is not public, so it is a column of its own, never
-- part of the payload GET /api/public/stats serves. Expand only: nullable,
-- and a missing state means a full count, as before.
set local lock_timeout = '5s';

alter table public_stats_cache add column state jsonb;

comment on column public_stats_cache.state is
  '0231: refresh bookkeeping (receipt marks, delete counter); never served.';
