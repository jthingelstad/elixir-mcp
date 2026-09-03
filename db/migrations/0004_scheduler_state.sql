-- 0004: scheduler state (DESIGN §5.3).
-- heat decays one tier per epoch WITHOUT activity — with a ~1-minute tick,
-- decay must be anchored to when heat last changed, not to tick count
-- (elixir-bot's 10-minute tick let it decay per-tick; ours cannot).
alter table poll_state add column heat_updated_at timestamptz not null default now();

-- Clan auto-follow (§4.2): the followed clan is read from the player's own
-- profile. The profile projector stamps it here; the planner derives the
-- followed-clan set from actively recorded players' stamps. This is a
-- last-known cache, NOT membership — observed tenure stays in
-- clan_membership, written only from clan roster payloads.
alter table player add column last_known_clan_tag text;
