-- A non-200 collector result has no API payload and must not advance
-- freshness, but it is still the operational receipt needed to distinguish
-- an upstream refusal from a collector or transport failure. Keep only the
-- bounded, non-payload result metadata; completed job rows prune separately.
create table collector_fetch_error (
  fetch_error_id bigint generated always as identity primary key,
  job_id bigint,
  gateway_id uuid not null references gateway,
  endpoint text not null,
  entity_key text not null,
  fetched_at timestamptz not null,
  http_status integer check (http_status between 100 and 599),
  error_kind text not null check (error_kind in ('transport', 'http', 'overflow', 'breaker', 'unknown')),
  recorded_at timestamptz not null default now(),
  unique (gateway_id, endpoint, entity_key, fetched_at)
);

create index collector_fetch_error_recorded_at
  on collector_fetch_error (recorded_at desc);
