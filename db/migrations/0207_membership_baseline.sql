-- 0207: a first sight of a player in a clan is a baseline, not a join.
-- The fresh-person journey on 2026-10-08 read "alex joined ClashCoachAIcom"
-- on the timeline: the first roster read of a clan alex founded and leads
-- opened his membership row, and the player timeline narrates every row
-- that opens inside its window as a join. The roster's own events already
-- kept the first sight of a clan silent (roster.mjs, open rows empty), but
-- that rule missed two cases:
--   * the player timeline reads clan_membership, not the clan's events, so
--     a first read still became "joined" there;
--   * a clan read only for the tracked players in it (activity reads of a
--     clan nobody tracks record just those players) that then becomes
--     tracked (Elixir follows the primary's clan, 0205/0206) diffs its
--     whole roster against the one or two rows it had, and every other
--     member would have read as joining.
--   clan_membership.baseline: true when the row opened on a read that could
--     not have seen the player absent before (the clan's first read, the
--     first read that records a member the previous read did not). The
--     join itself was not observed, so no moment names it. False (the
--     default) is an observed join. Existing rows are not rewritten: rows
--     written before 0207 read as joins, as they did (cleanup is Jamie's
--     call; docs/NOTES.md 2026-10-08).
--   clan.roster_recorded_all: whether the clan's latest roster read
--     recorded every member (a tracked clan) or only the tracked players in
--     it. Null until the first read after 0207.
-- The rules live in packages/ingest/src/roster.mjs. Both columns are
-- nullable or carry a constant default, so no row is rewritten.
-- Locks: clan_membership and clan, catalog-only changes, for an instant;
-- fail fast behind a reader.
set local lock_timeout = '5s';

alter table clan_membership add column baseline boolean not null default false;
comment on column clan_membership.baseline is
  '0207: the row opened on a baseline read (the clan''s first read, or the first read that recorded this member): Elixir first saw the player here and did not observe a join. Rows before 0207 read false.';

alter table clan add column roster_recorded_all boolean;
comment on column clan.roster_recorded_all is
  '0207: whether the clan''s latest admitted roster read recorded every member (true) or only the tracked players in it (false). Null before the first read after 0207.';
