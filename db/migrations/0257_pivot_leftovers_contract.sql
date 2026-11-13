-- 0257: the social-layer pivot's leftovers, the contract step.
--
-- Jamie approved removing what the pivot to the social layer
-- (VISION.md) left with no purpose (2026-11-13: "Agree with your
-- recommendations. I think you can make these calls through this
-- pivot."). Their last readers and writers left in earlier builds:
-- PR #925 (/api/v1 keeps only GET /api/v1/me, JSON API 5.0.0), PR #928
-- (the integration principal) and PR #930 (the Settings year graph and
-- its nightly rebuild). The change notes are
-- docs/notes/2026-11-13-api-v1-sign-in-only.md,
-- docs/notes/2026-11-13-users-and-agents.md and
-- docs/notes/2026-11-13-pivot-leftovers.md.
--
-- Dropped tables:
--   player_activity: 0084's nightly battle-activity histogram, read only
--     by the Settings year graph (GET /api/me/battle-activity/*) and
--     written only by the jobs Lambda's {activity_histogram}; both gone.
--   integration_usage, integration_profile_refresh: an integration's
--     daily call and profile-refresh counts (0058). The /api/v1 surface
--     that wrote them is GET /api/v1/me alone since #925.
--
-- Dropped columns of integration (0058): scopes, daily_limit,
-- hourly_limit, refresh_limit. Nothing reads them: the {integration} op
-- reads account_id, name and created_at (list), and the account and its
-- tokens (revoke, revoke_legacy). The table stays: Clan's morning run
-- reads integration where name = 'elixir-clan', and the op keeps listing
-- and revoking what is stored.
--
-- Tightened: oauth_code_resource_shape and oauth_family_resource_shape
-- (0160) stop admitting /i/<public_id>/mcp, an integration's MCP door
-- that no credential ever opened and that no code names since JSON API
-- 5.0.0 (packages/auth/src/oauth.mjs RESOURCE_PATH_RE). Everything else
-- the CHECK enforced stays: the literal host, https, and exactly
-- /mcp, /api/v1 or /a/<8-16 lowercase alphanumerics>/mcp. No stored row
-- holds an /i/ audience, so the new CHECK validates at once; both tables
-- are small (codes live minutes, families 90 days).
--
-- Not touched: integration itself, service_token's 'integration_api'
-- audience (revoked keys keep their rows) and attested_fact.
--
-- Locks: ACCESS EXCLUSIVE on each dropped table (nothing reads them),
-- on integration for the column drops (a catalog change, no rewrite)
-- and on oauth_code and oauth_family while their CHECK validates (a
-- scan of a small table). Fail fast behind a long read rather than
-- queue sign-ins.
set local lock_timeout = '5s';

drop table player_activity;
drop table integration_profile_refresh;
drop table integration_usage;

alter table integration
  drop column scopes,
  drop column daily_limit,
  drop column hourly_limit,
  drop column refresh_limit;

alter table oauth_code drop constraint oauth_code_resource_shape;
alter table oauth_code add constraint oauth_code_resource_shape check (
  resource ~ '^https://elixir\.poapkings\.com/(mcp|api/v1|a/[a-z0-9]{8,16}/mcp)$'
);
alter table oauth_family drop constraint oauth_family_resource_shape;
alter table oauth_family add constraint oauth_family_resource_shape check (
  resource ~ '^https://elixir\.poapkings\.com/(mcp|api/v1|a/[a-z0-9]{8,16}/mcp)$'
);

comment on column oauth_family.resource is
  'RFC 8707 audience. https://elixir.poapkings.com/mcp for a person at MCP; /api/v1 for a person at Sign in with Elixir; /a/<public_id>/mcp for an agent. A token is valid at exactly one. The integration door /i/<public_id>/mcp left the CHECK in 0257.';
comment on table integration is
  '0058: an integration principal''s account and name. Since 0257 only its identity: the scopes and limits went with the integration door (JSON API 5.0.0). Clan''s morning run reads name = ''elixir-clan''; the {integration} op lists and revokes.';
