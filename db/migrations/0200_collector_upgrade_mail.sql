-- 0200: observed collector transitions and sourced release notes.
-- Jamie requested one notice per installed upgrade, 2026-10-03. Empty
-- baseline avoids announcing the fleet's first heartbeat as an upgrade.
-- No history backfill: historical tests are explicitly labelled replays.
-- The gateway lock is catalog-only and fails fast behind a busy reader.
set local lock_timeout = '5s';
alter table gateway add column mail_observed_version text;
comment on column gateway.mail_observed_version is
  'Last door-reported version for upgrade detection (0200); null until the first version-bearing heartbeat. Ingest replays never change it.';
create table collector_version_event (
  event_id uuid primary key default gen_random_uuid(),
  gateway_id uuid not null references gateway,
  account_id uuid not null references account,
  from_version text not null,
  to_version text not null,
  observed_at timestamptz not null default now(),
  signature_state text not null,
  test boolean not null default false,
  replay_key text unique,
  evidence text,
  release_details jsonb,
  send_id uuid not null default gen_random_uuid(),
  completed_at timestamptz,
  outcome text
);
create index collector_version_event_pending on collector_version_event (observed_at)
  where completed_at is null;
comment on table collector_version_event is
  'Atomic authenticated door version transitions, or explicitly labelled owner-only historical tests (0200). One stable send identity per event; terminal outcomes retain skipped transitions.';
create table collector_release_note (
  version text primary key,
  release_url text not null,
  changes text,
  reason text,
  recorded_at timestamptz not null default now()
);
comment on table collector_release_note is
  'GitHub release notes and optional maintainer-supplied naming reason (0200). They explain release purpose, never prove why a particular host installed it.';
