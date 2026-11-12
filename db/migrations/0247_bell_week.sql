-- 0247: the bell's week of your own players, stored per account
-- (2026-11-12, #649).
--
-- The bell sits on every signed-in page, and every read built the last
-- seven days of the account's own verified players with the timeline
-- builder to find the items other people cheered: GET /api/me/bell p95
-- 12,064 ms over three days (n 32, ten past 3 s). Home is not ready in
-- 2 s while the bell is not.
--
-- bell_week: that build, kept like Home's week (home_feed, 0245): built
-- by the read when there is none, the account's own players changed, or
-- it is older than three hours; rebuilt in the background by the
-- timeline-sync lane when a read finds it older than fifteen minutes.
-- Highlights and attested facts are read live over it, as Home does, and
-- cheers are always the read's own. A cache: the record stays the truth.
-- One row per account; no row means none has been built.
--
-- A new, empty table. Its foreign key takes a SHARE ROW EXCLUSIVE lock on
-- account for an instant (nothing to validate): fail fast rather than
-- queue sign-ins behind a long read, and let the deploy be retried. The
-- foreign key does not cascade: {account_remove} deletes the row with the
-- account's others.

set local lock_timeout = '5s';

create table bell_week (
  account_id  uuid primary key references account,
  window_from timestamptz not null,
  window_to   timestamptz not null,
  built_at    timestamptz not null default now(),
  build_ms    integer not null,
  own_key     text not null,
  items       jsonb not null
);

comment on table bell_week is
  '0247: the account''s last built bell week, its own verified players'' items (2026-11-12, #649). A cache of the timeline builder''s output; the record is the truth.';
comment on column bell_week.window_from is
  'The week the build read: from.';
comment on column bell_week.window_to is
  'The week the build read: to.';
comment on column bell_week.build_ms is
  'How long the build took, for the latency notes.';
comment on column bell_week.own_key is
  'A digest of the account''s own verified players when built. A read whose players differ rebuilds.';
comment on column bell_week.items is
  'The finished items that take cheers, newest first, as the builder served them; two server-only fields kept as _spark and _evidence_source.';
