-- 0321: account_visit_day, one row a person a UTC day they used the
-- website while signed in.
--
-- 2026-11-28 (#1260): the website's own reads left mcp_call_audit, and
-- with them the ops funnel's evidence that a person came back to the
-- website on a session made earlier. Jamie, 2026-11-28, on being told:
-- "that funnel data is good to have… we should make sure that we know
-- when authenticated visitors do return".
--
-- A visit mark, not a call log: the account and the day, nothing else.
-- No path, no tool, no count, no address, no device, no time of day. The
-- web-api writes it (insert ... on conflict do nothing) when the app's
-- session read, GET /api/me, answers a cookie session; never the MCP
-- door, GET /api/v1/me, a bearer token, the collector door or a job
-- (docs/notes/2026-11-28-account-visit-days.md). The funnel reads it
-- (services/migrate/src/ops-funnel.mjs); the daily trim keeps a year
-- (packages/record/src/retention.mjs) and account removal deletes it
-- (packages/auth/src/account-remove.mjs).
--
-- The primary key leads with the account, which is how the writer and
-- the funnel reach it. No index on day: the table is small and the trim
-- reads it once a day; one is added when a measured plan asks.
--
-- A new table only: nothing existing is locked or rewritten.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table account_visit_day (
  account_id  uuid not null references account on delete cascade,
  day         date not null,
  primary key (account_id, day)
);

comment on table account_visit_day is
  '0321: a UTC day on which the signed-in person used the website (the app''s session read on a cookie session). One row a person a day and nothing else: not a call log, no path, address, device, count or time of day. Read by the ops funnel; kept a year.';
