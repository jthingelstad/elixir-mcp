-- 0317: an account is a person; the agent and integration schema goes
-- (2026-11-23).
--
-- Jamie, 2026-11-23: "Approved: remove the Agents concept from Elixir",
-- "Delete the old agent accounts." and "Approved: delete the three
-- integration accounts and remove the integration account kind from
-- Elixir". The {agent_accounts_remove} and {integration_accounts_remove}
-- ops delete the rows (docs/notes/2026-11-23-integration-accounts-removed.md).
-- This migration refuses, and changes nothing, while any is left: run
-- those ops for real first, then deploy this.
--
-- Narrowed: account_kind_check to person alone (the column stays, so the
-- readers that ask for a person keep working; a test identity is a person,
-- test_name); service_token_audience_check to mcp, the integration_api
-- audience having had no validator since 0257; oauth_code_resource_shape
-- and oauth_family_resource_shape to exactly /mcp and /api/v1, the agent
-- door /a/<public_id>/mcp gone.
--
-- Dropped: agent_identity (an agent's map from its end-user ids to player
-- tags), integration (an integration's name), account.owned_by_account_id
-- and account_ownership_matches_kind (the person who owned an agent or an
-- integration), account.public_id (their URL segment and op handle; null
-- for every person), account.removed_at (an owner hiding a suspended
-- agent, 0215) and mcp_call_audit.on_behalf_of (the end-user id an agent's
-- call relayed; nothing has written or read it since the one MCP
-- endpoint).
--
-- Kept as history: mcp_call_audit_principal_kind_check still admits
-- 'agent' and 'integration', which the call log's rows from before the
-- removal carry until the 28-day rule ages them out; feedback.via, whose
-- old rows may name the on_behalf_of they were filed with.
--
-- Locks: ACCESS EXCLUSIVE on account, service_token, oauth_code,
-- oauth_family, mcp_call_audit, agent_identity and integration. All but
-- mcp_call_audit are small; each new CHECK scans its table once. Dropping
-- a column is catalog-only, mcp_call_audit included.

set local lock_timeout = '5s';

do $$
declare
  others int;
  identities int;
  integrations int;
  keys int;
  doors int;
begin
  select count(*) into others from account where kind <> 'person';
  select count(*) into identities from agent_identity;
  select count(*) into integrations from integration;
  select count(*) into keys from service_token where audience <> 'mcp';
  select (select count(*) from oauth_family
           where resource !~ '^https://elixir\.poapkings\.com/(mcp|api/v1)$')
       + (select count(*) from oauth_code
           where resource !~ '^https://elixir\.poapkings\.com/(mcp|api/v1)$')
    into doors;
  if others > 0 or identities > 0 or integrations > 0 or keys > 0 or doors > 0 then
    raise exception
      '0317 refuses: % account(s) that are not a person, % agent identity row(s), % integration row(s), % integration_api key(s) and % OAuth grant(s) or code(s) for an agent door are left. Run the {agent_accounts_remove} and {integration_accounts_remove} ops for real first (docs/notes/2026-11-23-integration-accounts-removed.md), then deploy again.',
      others, identities, integrations, keys, doors;
  end if;
end
$$;

alter table account drop constraint account_ownership_matches_kind;
alter table account drop constraint account_kind_check;
alter table account add constraint account_kind_check check (kind = 'person');
alter table account drop column owned_by_account_id;
alter table account drop column public_id;
alter table account drop column removed_at;

alter table service_token drop constraint service_token_audience_check;
alter table service_token add constraint service_token_audience_check
  check (audience = 'mcp');

alter table oauth_code drop constraint oauth_code_resource_shape;
alter table oauth_code add constraint oauth_code_resource_shape check (
  resource ~ '^https://elixir\.poapkings\.com/(mcp|api/v1)$'
);
alter table oauth_family drop constraint oauth_family_resource_shape;
alter table oauth_family add constraint oauth_family_resource_shape check (
  resource ~ '^https://elixir\.poapkings\.com/(mcp|api/v1)$'
);

drop table agent_identity;
drop table integration;
alter table mcp_call_audit drop column on_behalf_of;

comment on column account.kind is
  'person, always (0317). A test identity is a person too (test_name).';
comment on column oauth_family.resource is
  'RFC 8707 audience: https://elixir.poapkings.com/mcp for a person at MCP, /api/v1 for a person at Sign in with Elixir. A token is valid at exactly one.';
comment on column mcp_call_audit.principal_kind is
  'person: what kind of principal made the call. ''agent'' and ''integration'' are history, on rows from before 0317 that age out on the 28-day rule.';
comment on column feedback.via is
  'Who filed it through what (0204): principal_kind, client_name, request_id (the filing call itself). Rows filed before 0317 may also hold on_behalf_of, the end-user id an agent relayed for. Null before 0204.';
comment on column attested_fact.source is
  'The family app or Elixir part that wrote it: for a person''s fact, the app its client was provisioned for (0185), keyed as its rows always were (clan.poapkings.com, drop.poapkings.com; a later app by its name), an identifier and not an address (0195); for one Elixir writes itself, its part (elixir-clan), with no attester. Rows an integration wrote before 0317 keep its name (elixir-drop).';
comment on column attested_fact.visibility is
  'clan: anyone whose verified player is in the clan; leaders: a person whose verified player leads it (never mail); player: whoever has the player on their timeline. From the type (@elixir-mcp/contracts ATTESTED_FACT_TYPES).';
comment on index mcp_call_audit_by_account is
  '0238: an account''s calls, newest first.';
comment on table account_passport is
  '0269: a person account''s passport. passport_id is random and opaque, the only id a passport URL carries; never the account UUID.';
