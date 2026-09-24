-- 0172: when a collection's membership was last replaced by a sync.
--
-- A board collection (synced_from) is re-synced daily by clients/boards
-- with collections_edit action 'set'. When a sync did not run, the
-- collection kept yesterday's board while its note said "today's
-- membership" (Gym #322: pol-global-top-100 matched yesterday's board 100
-- of 100 and today's 56). collections_edit stamps this on every 'set';
-- collections_get serves it beside the board's newest snapshot.

alter table collection add column synced_at timestamptz;

comment on column collection.synced_at is
  'The last collections_edit action set on this collection (the board sync for a synced_from collection); null before 2026-09-24 or for a collection never set.';
