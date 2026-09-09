-- Platform credentials have an explicit audience. Existing MCP keys are unchanged.
alter table service_token add column audience text not null default 'mcp'
  check (audience in ('mcp', 'integration_api'));
create table integration (
  account_id uuid primary key references account,
  name text not null unique,
  scopes text[] not null,
  daily_limit integer not null check (daily_limit between 1 and 1000000),
  hourly_limit integer not null check (hourly_limit between 1 and 100000),
  refresh_limit integer not null check (refresh_limit between 0 and 100000),
  created_at timestamptz not null default now()
);
create table integration_collection_grant (
  account_id uuid references integration,
  collection_id bigint references collection,
  member_limit integer not null check (member_limit between 1 and 100000),
  primary key (account_id, collection_id)
);
alter table collection_member add column added_by_integration uuid references integration;
create table integration_usage (
  account_id uuid references integration,
  day date not null,
  calls integer not null default 0,
  refreshes integer not null default 0,
  primary key (account_id, day)
);
-- Job IDs deliberately have no FK: the ledger prunes completed jobs.
create table integration_profile_refresh (
  refresh_id uuid primary key default gen_random_uuid(),
  account_id uuid not null references integration,
  player_tag text not null,
  idempotency_key text not null,
  job_id bigint not null,
  created_at timestamptz not null default now(),
  unique(account_id, idempotency_key)
);
create index integration_refresh_subject on integration_profile_refresh (player_tag, created_at desc);
alter table mcp_call_audit add column http_status integer;
