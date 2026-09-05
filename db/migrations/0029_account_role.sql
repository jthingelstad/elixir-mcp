-- The entitlement ladder (Jamie, 2026-09-05): member -> leader ->
-- family -> partner -> admin. Quota DEFAULTS live in
-- packages/contracts/src/roles.ts (single source); the existing
-- nullable per-account columns (max_player_recordings,
-- mcp_daily_quota, and live_daily_quota added here) remain hand-tuned
-- OVERRIDES that beat the role default. Roles never gate visibility -
-- universal reads stands; they gate collection and call volume.

alter table account add column role text not null default 'member'
  check (role in ('member', 'leader', 'family', 'partner', 'admin'));

alter table account add column live_daily_quota integer;

-- The owner ran unlimited via is_owner exemptions; the ladder makes
-- that explicit. is_owner keeps meaning "the operator of the service"
-- (admin UI access); role carries the quota semantics.
update account set role = 'admin' where is_owner;
