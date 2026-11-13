-- 0251: the grant shape accepts follows:write, the scope recordings:write
-- was renamed to on 2026-11-13 ("follow, never track").
--
-- Both names are allowed in the same slot. Rows already stored keep
-- recordings:write and are never rewritten: every read maps the old name
-- to the new one (currentScopeNames in @elixir-mcp/auth), so no grant,
-- code or token loses its authority and nobody consents again. New grants
-- are written with follows:write.
--
-- Added NOT VALID (no scan under the ACCESS EXCLUSIVE lock); 0252
-- validates in its own migration. Both tables hold one row per
-- connection; lock_timeout bounds the brief lock.

set local lock_timeout = '5s';

alter table oauth_code drop constraint oauth_code_scope_shape;
alter table oauth_code add constraint oauth_code_scope_shape check (
  scope ~ '^cr:read( recordings:write| follows:write)?( collections:write)?( account:write)?( feedback:write)?( account:email)?( clans:attest)?$'
) not valid;
alter table oauth_family drop constraint oauth_family_scope_shape;
alter table oauth_family add constraint oauth_family_scope_shape check (
  scope ~ '^cr:read( recordings:write| follows:write)?( collections:write)?( account:write)?( feedback:write)?( account:email)?( clans:attest)?$'
) not valid;

comment on column oauth_family.scope is
  'Space-separated OAuth grant, in OAUTH_SCOPE_DETAILS order. account:email (0082) and clans:attest (0178) are granted only to a family app that asked for them by name. recordings:write is the old name of follows:write (0251): read as follows:write, never rewritten.';
