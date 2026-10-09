-- 0209: live_fetch only fetches.
-- Jamie, 2026-10-08: "Based on current layout of Elixir I would say that
-- live_fetch should ONLY live fetch and not record data." A live_fetch of
-- two untracked players that day left profile snapshots in the record,
-- because a live-lane result was admitted and projected like any other.
--   job.record: whether the job's result enters the record. Every job
--     that exists, and every job the planner or a recording live read
--     mints, keeps true (a constant default, so no row is written).
--     live_fetch mints false. A recording ask for a subject whose open
--     job is false turns it true; a fetch-only ask never turns a
--     recording job false.
--   live_fetch_result: where a fetch-only result waits for the caller's
--     next ask. Not the record: no projection, no api_receipt or
--     api_payload row, no S3 archive object (so no replay can project
--     it), no poll_state freshness. Rows older than an hour are deleted
--     by the next fetch-only result; the reader takes only a row inside
--     the API's own cache window (60 to 120 s).
-- Locks: job (operational, pruned weekly) for an instant, catalog-only;
-- fail fast behind a reader.
set local lock_timeout = '5s';

alter table job add column record boolean not null default true;

create table live_fetch_result (
  job_id           bigint primary key,
  endpoint         text not null,
  entity_key       text not null,
  fetched_at       timestamptz not null,
  gateway_id       uuid not null references gateway,
  admission        text not null check (admission in ('admitted', 'rejected')),
  admission_errors text[],
  payload_json     jsonb,
  created_at       timestamptz not null default now()
);

create index live_fetch_result_subject
  on live_fetch_result (endpoint, entity_key, fetched_at desc);
create index live_fetch_result_fetched_at on live_fetch_result (fetched_at);
