-- 0304: an author's recorded game achievement attached to a post.
-- Jamie, 2026-11-18: write about an actual own verified Timeline milestone.
-- Read-only production census 2026-11-18: estimated eight live rows, one
-- 8,192-byte heap page (188,416 bytes including indexes).
-- Add one nullable column, a metadata-only change taking an instant table
-- lock. Old posts stay null; no rows are rewritten, copied or backfilled.
-- The canonical source resolves ownership and public game eligibility before
-- creation; every reader shares the closed attachment projection.
set local lock_timeout = '5s';
alter table account_post add column moment jsonb;
comment on column account_post.moment is
  '0304: immutable canonical public game achievement (identity, original time, player, sentence and source locator) selected by its verified owner at creation. Null means no milestone attachment. No client facts or private Clan/People state.';
