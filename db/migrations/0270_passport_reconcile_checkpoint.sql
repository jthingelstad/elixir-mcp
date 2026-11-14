-- 0270: The owner's passport reconciliation keeps its place in the
-- record, two columns on account_passport (2026-11-14, #1015).
--
-- POST /api/me/passport/reconcile (packages/stamps earn.mjs) reads the
-- account's recorded friendly battles for Played Together. It reads by
-- ingestion, not by when a battle was played: battle.cursor, the
-- identity every recorded battle gets when it is written, so a battle
-- the record learns late (a player polled after a quiet spell) is read
-- once, when it arrives, whatever its battle_time.
--
-- account_passport.played_cursor: the highest battle.cursor the owner's
-- reconciliation has finished with. Null means never read: the first
-- call starts from its look-back window. It only moves forward
-- (greatest), so two calls racing cannot move it back.
-- account_passport.reconciled_at: when a reconciliation last finished.
-- Null means never.
--
-- Nullable columns with no default on a new, small table: catalog-only.
-- The ALTER takes an ACCESS EXCLUSIVE lock on account_passport for an
-- instant: fail fast rather than queue passport reads behind it.

set local lock_timeout = '5s';

alter table account_passport add column played_cursor bigint;
alter table account_passport add column reconciled_at timestamptz;

comment on column account_passport.played_cursor is
  '0270: the highest battle.cursor (ingestion order) the owner''s reconciliation has read for Played Together. Null means never read. Only moves forward.';
comment on column account_passport.reconciled_at is
  '0270: when the owner''s reconciliation last finished. Null means never.';
