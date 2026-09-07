-- OAuth grants must say both WHAT a client may do and WHERE its bearer
-- may be used. Existing families become read-only: cr:read is exactly
-- what their consent page promised, so backfilling write access would
-- manufacture authority the user never granted.
--
-- Defaults keep the expand-first deploy safe: the migration Lambda runs
-- before the new MCP code is flipped, and the old code can still insert
-- rows during that window.

alter table oauth_code alter column scope set default 'cr:read';
update oauth_code set scope = 'cr:read' where scope is null;
alter table oauth_code alter column scope set not null;
alter table oauth_code add column resource text not null
  default 'https://elixir.poapkings.com/mcp';

alter table oauth_family add column scope text not null default 'cr:read';
alter table oauth_family add column resource text not null
  default 'https://elixir.poapkings.com/mcp';

alter table oauth_code add constraint oauth_code_scope_shape check (
  scope ~ '^cr:read( recordings:write)?( collections:write)?( account:write)?( feedback:write)?$'
);
alter table oauth_family add constraint oauth_family_scope_shape check (
  scope ~ '^cr:read( recordings:write)?( collections:write)?( account:write)?( feedback:write)?$'
);
alter table oauth_code add constraint oauth_code_resource_shape check (
  resource = 'https://elixir.poapkings.com/mcp'
);
alter table oauth_family add constraint oauth_family_resource_shape check (
  resource = 'https://elixir.poapkings.com/mcp'
);

comment on column oauth_family.scope is
  'Canonical space-separated OAuth grant. Existing families were backfilled to cr:read because prior consent promised reads only.';
comment on column oauth_family.resource is
  'RFC 8707 audience. Access tokens in this family are valid only at the canonical MCP resource.';
