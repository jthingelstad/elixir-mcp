-- 0245: Home's week, stored per account (2026-11-12, #649).
--
-- Home's feed built the last seven days on every first page. On the
-- db.t4g.micro that read is cold I/O: the owner's week (55 players, 3
-- clans) measured 12.3 s at 15:07 CT on 2026-11-12, 10.5 s of it in the
-- database, 6.8 s in the batched player read alone, and GET
-- /api/me/home/feed's p95 over three days was 15.2 s. Computing on read
-- cannot reach Home's 2 s bar on this instance, and Jamie's ruling of
-- 2026-11-12 allows a stored feed when it cannot (the note:
-- docs/notes/2026-11-12-home-feed-stored.md).
--
-- home_feed: the account's last built week, as the timeline builder
-- finished it, without the account's own administration (the bell tells
-- that). Built by the timeline-sync Lambda when the five-minute wake or a
-- read finds it older than fifteen minutes, and by the read itself when
-- there is none, its subjects or time zone changed, or it is older than
-- three hours. A cache: the record stays the truth, and a row can be
-- rebuilt from it at any time. One row per account; no row means none
-- has been built.
--
-- A new, empty table. Its foreign key takes a SHARE ROW EXCLUSIVE lock
-- on account for an instant (nothing to validate): fail fast rather than
-- queue sign-ins behind a long read, and let the deploy be retried. The
-- foreign key does not cascade: {account_remove} deletes the row with the
-- account's others.

set local lock_timeout = '5s';

create table home_feed (
  account_id   uuid primary key references account,
  window_from  timestamptz not null,
  window_to    timestamptz not null,
  built_at     timestamptz not null default now(),
  build_ms     integer not null,
  timezone     text not null,
  subjects_key text not null,
  items        jsonb not null,
  more         integer not null default 0,
  read_at      timestamptz
);

comment on table home_feed is
  '0245: the account''s last built Home week (2026-11-12, #649). A cache of the timeline builder''s output; the record is the truth.';
comment on column home_feed.window_from is
  'The week the build read: from, inclusive of what the record learned after it.';
comment on column home_feed.window_to is
  'The week the build read: to. The read serves items up to here, and highlights posted since.';
comment on column home_feed.build_ms is
  'How long the build took, for the latency notes.';
comment on column home_feed.timezone is
  'The time zone the items'' local times were written in. A read in another rebuilds.';
comment on column home_feed.subjects_key is
  'A digest of the players and clans the account followed, with nicknames, when built. A read whose subjects differ rebuilds.';
comment on column home_feed.items is
  'The finished items, newest first, as the builder served them; two server-only fields kept as _spark and _evidence_source and never served.';
comment on column home_feed.more is
  'Items the builder''s cap left out of the week.';
comment on column home_feed.read_at is
  'When Home last read the row, to the hour. The five-minute wake keeps rows read in the last three days fresh; null means never read.';
