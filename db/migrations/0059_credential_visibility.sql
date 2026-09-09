-- Who is using a credential, from where, and which ones are being presented
-- after they stopped working.
--
-- Jamie, 2026-09-09: "with 5 agents and 3 AI tools using it, visibility into
-- token use is a big deal" — and the trigger was noticing that a superseded
-- personal token was still live with no way to tell whether anything was
-- presenting it.
--
-- Two halves, because the failures look different:
--
--   SUCCESS is already recorded per call in mcp_call_audit (token_id since
--   0052). What it could not say was WHERE from or WHICH client, so five
--   agents on one account were five identical rows of "something called
--   war_current".
--
--   REFUSAL was recorded nowhere at all. A rejected credential never reaches
--   the audit table — the invoker writes after authentication — so a runtime
--   presenting a revoked key produced silence, and the console showed an agent
--   that merely looked idle. That is not hypothetical: it happened here on
--   2026-09-09 when a key rotation took a Discord bot offline.

alter table mcp_call_audit add column viewer_ip inet;
alter table mcp_call_audit add column viewer_country text;
-- The client as it identifies itself: a service token's name, or the OAuth
-- client that holds the access token. Denormalised on purpose — the answer to
-- "what was using this in July" must survive the credential being deleted.
alter table mcp_call_audit add column client_name text;

comment on column mcp_call_audit.viewer_ip is
  'Caller IP from CloudFront-Viewer-Address. Scrubbed by housekeeping after 30 days; the row survives without it.';

-- One row per credential per source per day, counted. A dead client retrying
-- every five minutes is 288 attempts and one row, which is the shape that
-- answers "is something still presenting this?" without becoming a log.
create table credential_refusal (
  refusal_id      bigint generated always as identity primary key,
  day             date not null default current_date,
  -- sha256 of what was presented. Never the credential: enough to tell one
  -- persistent client from a spray, useless for authenticating anything.
  credential_hash text not null,
  -- Set when the credential is RECOGNISED but not usable — revoked, or on a
  -- suspended account, or at the wrong door. That is the case worth an alert,
  -- because it names a key its owner already knows about.
  token_id        bigint references service_token,
  account_id      uuid references account,
  kind            text not null check (kind in ('service_token', 'access_token', 'unknown')),
  reason          text not null,
  resource        text,
  viewer_ip       inet,
  viewer_country  text,
  attempts        integer not null default 1,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);

-- NULLS NOT DISTINCT so an unknown IP coalesces with itself instead of
-- inserting a row per attempt.
create unique index credential_refusal_daily
  on credential_refusal (day, credential_hash, viewer_ip, resource)
  nulls not distinct;

create index credential_refusal_by_account
  on credential_refusal (account_id, day desc) where account_id is not null;

comment on table credential_refusal is
  'Credentials presented and refused, coalesced per day and source. Retained 30 days by housekeeping.';
