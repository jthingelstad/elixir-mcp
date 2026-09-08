-- Three kinds of principal, one account table.
--
-- `account` has always been a PERSON: email_hash, timezone, newsletter_opt_in,
-- and a `claim` row whose is_primary means literally "me". A service token was
-- only ever a credential hanging off one, so a clan agent inherited its
-- owner's identity wholesale -- their primary tag, their event cursor, their
-- feedback, their entitlements. The 0020 comment admitted it: "Bound to the
-- OWNER's account by default ... a different binding can come later."
--
--   person       a human. OAuth only.
--   agent        owned by a person, acts FOR a clan. OAuth or service token.
--   integration  owned by a person, no "me", consumes the corpus. Token only.
--
-- STRICTLY EXPAND, and every default reproduces today's behaviour exactly:
-- existing accounts are persons, existing tokens keep every scope and inherit
-- their account's quota. Nothing running against this schema can notice.

alter table account add column kind text not null default 'person'
  check (kind in ('person', 'agent', 'integration'));

-- Who is answerable for this principal. Persons have no owner; agents and
-- integrations must. That an owner must itself be a person is enforced in the
-- application, not here: the check needs a subquery, and a trigger is a poor
-- trade for an invariant with exactly one write path.
alter table account add column owned_by_account_id uuid references account;

alter table account add constraint account_ownership_matches_kind check (
  (kind = 'person' and owned_by_account_id is null)
  or (kind in ('agent', 'integration') and owned_by_account_id is not null)
);

-- The URL segment (phase 4): /a/<public_id>/mcp, /i/<public_id>/mcp.
-- Short and RANDOM, not a sequence -- a monotonic id tells anyone holding one
-- how many exist. Null for persons, who are served at the canonical /mcp.
alter table account add column public_id text unique
  check (public_id ~ '^[a-z0-9]{8,16}$');

-- An agent has no email. This is the constraint that forces the model change
-- to be honest rather than a person-shaped row with the name field blanked.
-- Postgres permits many NULLs under a unique index, so the uniqueness that
-- matters for real addresses is untouched.
alter table account alter column email_hash drop not null;

alter table account add constraint account_person_has_email check (
  kind <> 'person' or email_hash is not null
);

-- An agent's "me" is a clan. Several are allowed (a clan family); one is the
-- default subject, mirroring claim.is_primary on the person side.
alter table account_clan add column is_primary boolean not null default false;
create unique index account_clan_one_primary_per_account
  on account_clan (account_id) where is_primary;

-- Per-key authority and budget.
--
-- scope: today validateServiceToken hands EVERY token the full scope list, so
-- Elixir Drop's credential can edit collections and change account settings in
-- order to read a war clock. NULL preserves exactly that behaviour for the
-- tokens that already exist; new keys are written narrow.
--
-- daily_quota / hourly_rate_limit: NULL means inherit the owning account, which
-- is what an agent wants (it spends its parent's budget). An integration sets
-- its own, because its traffic scales with ITS userbase and has nothing to do
-- with its owner's personal usage.
alter table service_token add column scope text;
alter table service_token add column daily_quota integer;
alter table service_token add column hourly_rate_limit integer;

-- Token names were globally unique, which was survivable while only the owner
-- could mint one. With agents open to every account, the first person to name
-- a token 'poap-kings' would take that name from everyone. Uniqueness belongs
-- inside the account.
alter table service_token drop constraint service_token_name_key;
alter table service_token add constraint service_token_name_per_account
  unique (account_id, name);

comment on column account.kind is
  'person | agent | integration. Persons are humans; agents act for a clan; integrations consume the corpus with no "me".';
comment on column account.public_id is
  'Opaque URL segment for agent and integration MCP resources. Random, never sequential.';
comment on column service_token.scope is
  'Space-separated OAuth scopes this key may use. NULL = every scope, the pre-0053 behaviour.';
comment on column service_token.daily_quota is
  'Calls per day for this key. NULL = inherit the owning account.';
