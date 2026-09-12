-- 0082: account:email, the one OAuth capability never offered unasked
-- (2026-09-12).
--
-- A first-party web product (Elixir Drop, Elixir Clan) signing a person
-- in WITH Elixir needs to know which person: the email on the account is
-- the identity both products key on, and Elixir has already proven it
-- with a code. GET /oauth/userinfo answers it for a token whose grant
-- carries account:email. The consent page shows the capability only when
-- the client names it; it is never a ticked extra, never part of the
-- default grant, and never advertised in a 401 challenge.
--
-- The grant shape constraints (0047) enumerate the canonical order, so
-- the new scope is appended there. Expand only: every existing grant
-- still matches.

alter table oauth_code drop constraint oauth_code_scope_shape;
alter table oauth_code add constraint oauth_code_scope_shape check (
  scope ~ '^cr:read( recordings:write)?( collections:write)?( account:write)?( feedback:write)?( account:email)?$'
);
alter table oauth_family drop constraint oauth_family_scope_shape;
alter table oauth_family add constraint oauth_family_scope_shape check (
  scope ~ '^cr:read( recordings:write)?( collections:write)?( account:write)?( feedback:write)?( account:email)?$'
);

comment on column oauth_family.scope is
  'Canonical space-separated OAuth grant, in OAUTH_SCOPE_DETAILS order. account:email (0082) is granted only to a client that asked for it by name and unlocks GET /oauth/userinfo.';
