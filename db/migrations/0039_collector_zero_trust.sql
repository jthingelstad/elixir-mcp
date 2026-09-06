-- 0039: collector zero-trust (COLLECTOR-ZERO-TRUST.md, Jamie's full go
-- 2026-09-06). Collectors become pure API clients: a bearer token we
-- issue (stored as sha256 only), a server-assigned channel, no IP
-- collected, no AWS credentials. The SQS path stays alive during the
-- migration; per-collector IAM users die at teardown.

-- Token: the collector's ONLY credential toward us.
alter table gateway add column token_hash text unique;

-- Channel: bulk is the only channel open to outside operators; live is
-- grantable by the owner and long-polls for the live-lane SLA.
alter table gateway add column channel text not null default 'bulk'
  check (channel in ('bulk', 'live'));

-- The IP was vestigial (the CR key's IP binding is operator<->Supercell
-- business): stop requiring it.
alter table gateway alter column static_ip drop not null;

-- Yield accounting: leases issued vs results submitted, the basis for
-- black-hole quarantine (a collapsing submit ratio stops being served).
alter table gateway add column leases_issued bigint not null default 0;
alter table gateway add column results_submitted bigint not null default 0;
-- Consecutive leases that expired unsubmitted; a submit resets it.
-- Crossing the quarantine threshold flips the gateway to draining.
alter table gateway add column missed_streak int not null default 0;

-- Outstanding leases: at most 2 unsubmitted per collector; rows expire
-- with the SQS visibility timeout (the job redelivers anyway).
create table gateway_lease (
  lease_id   bigint generated always as identity primary key,
  gateway_id uuid not null references gateway on delete cascade,
  issued_at  timestamptz not null default now()
);
create index gateway_lease_by_gateway on gateway_lease (gateway_id, issued_at);

-- The update authority: the server names the one binary version+hash a
-- collector may install (the config endpoint serves this; a compromised
-- GitHub release alone can no longer push code to operators).
create table collector_release (
  platform   text primary key,            -- e.g. 'go' (python has no binary)
  version    text not null,
  sha256     text not null,
  url        text not null,
  updated_at timestamptz not null default now()
);
