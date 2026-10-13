-- 0226: Public corpus statistics are an hourly projection, not a page-load scan.
-- Expand only: no canonical table is altered, and the old door still computes
-- its answer until the jobs Lambda has published the first snapshot.
create table public_stats_cache (
  cache_key integer primary key check (cache_key = 1),
  payload jsonb not null,
  updated_at timestamptz not null
);
