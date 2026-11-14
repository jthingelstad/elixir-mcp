-- 0271: When a person last asked for their own battles to be read now,
-- one column on account (2026-11-14).
--
-- Opening Elixir asks the live lane for a recording read of the person's
-- own verified players' battle logs (POST /api/me/refresh,
-- services/web-api/src/own-refresh.mjs), so a battle just played shows
-- without waiting for the scheduler. Every tab and device of one account
-- shares one floor: at most one such ask per five minutes. The floor is
-- this column, moved by one conditional UPDATE, so two asks at once
-- cannot both pass it [engineering, 2026-11-14].
--
-- account.own_refresh_at: when the last ask passed the floor. Null means
-- never. No backfill.
--
-- A nullable column with no default is catalog-only. It takes an ACCESS
-- EXCLUSIVE lock on account for an instant: fail fast rather than queue
-- sign-ins behind a long read, and let the deploy be retried.

set local lock_timeout = '5s';

alter table account add column own_refresh_at timestamptz;

comment on column account.own_refresh_at is
  '0271: when the account last asked for its own players'' battle logs to be read now (POST /api/me/refresh); the five-minute floor. Null means never.';
