-- 0160: the JSON API is a protected resource of its own.
--
-- Jamie, 2026-09-23: the JSON API is a public product beside MCP, and
-- Elixir Clan reads through it rather than through MCP. A person's OAuth
-- grant for it names the audience https://elixir.poapkings.com/api/v1. It
-- is a different DOOR, not a fourth principal: /mcp accepts no /api/v1
-- token, and /api/v1 accepts no /mcp token. The pattern stays identical to
-- RESOURCE_PATH_RE in services/auth/src/oauth.mjs, and
-- services/auth/test/principal-resources.test.mjs holds both to the same
-- matrix. Both tables are small; the new CHECK validates them at once.

set local lock_timeout = '5s';

alter table oauth_code drop constraint oauth_code_resource_shape;
alter table oauth_code add constraint oauth_code_resource_shape check (
  resource ~ '^https://elixir\.poapkings\.com/(mcp|api/v1|[ai]/[a-z0-9]{8,16}/mcp)$'
);
alter table oauth_family drop constraint oauth_family_resource_shape;
alter table oauth_family add constraint oauth_family_resource_shape check (
  resource ~ '^https://elixir\.poapkings\.com/(mcp|api/v1|[ai]/[a-z0-9]{8,16}/mcp)$'
);

comment on column oauth_family.resource is
  'RFC 8707 audience. https://elixir.poapkings.com/mcp for a person at MCP; /api/v1 for a person at the JSON API; /a/<public_id>/mcp for an agent; /i/<public_id>/mcp for an integration. A token is valid at exactly one.';
