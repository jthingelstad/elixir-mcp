-- 0263: Drop clan_state_import, the receipt of Clan's one-time import.
-- Clan moved its private state into Postgres once, from its store as a
-- separate app (0196), and this table held that import's digest and
-- counts: no bodies, no tokens. 0256 kept it for the retirement of Clan's
-- old family OAuth client, which no longer reads it (2026-11-13), and the
-- import code is gone. Clan is part of Elixir, not an app with a store of
-- its own (Jamie, 2026-11-12).
-- Deploy: no build reads the table on a running path; the previous
-- build's {family_clients: {retire_app}} with apply would fail here, so
-- that op runs on this build. The drop takes an ACCESS EXCLUSIVE lock on a
-- one-row table nothing else touches.
set local lock_timeout = '5s';

drop table clan_state_import;
