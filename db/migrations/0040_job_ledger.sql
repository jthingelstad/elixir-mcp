-- 0040: the Postgres job ledger (Jamie's go, 2026-09-06). SQS stopped
-- earning its keep in the collector path once the zero-trust door
-- became the boundary: jobs now live HERE, leased with SKIP LOCKED,
-- expired by timestamp, dead-lettered as a status - queryable,
-- alarmable, and un-dead-able with one UPDATE. Planning and insertion
-- share one transaction, so partial-send reconciliation (sol-6 F5's
-- whole class) ceases to exist. The email queue is untouched: it
-- bridges the VPC/non-VPC boundary, which is a different job.

create table job (
  job_id     bigint generated always as identity primary key,
  endpoint   text not null,
  entity_key text not null,
  lane       text not null check (lane in ('live', 'bulk')),
  status     text not null default 'queued'
             check (status in ('queued', 'leased', 'done', 'dead')),
  attempts   int not null default 0,
  leased_at  timestamptz,
  leased_by  uuid references gateway,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);

-- The planner is idempotent BY CONSTRUCTION: one queued job per
-- subject. A live request for an already-queued subject upgrades the
-- row's lane (see the enqueue helpers) instead of duplicating it.
create unique index job_one_queued_per_subject
  on job (endpoint, entity_key) where status = 'queued';

-- Lease scan: live first, oldest first.
create index job_lease_scan on job (status, lane, job_id);

-- Expiry sweep support.
create index job_leased_at on job (leased_at) where status = 'leased';

-- Done rows are operational residue; the weekly sweep prunes them.
create index job_done_at on job (done_at) where status = 'done';
