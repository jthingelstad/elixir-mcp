-- 0246: the welcome checklist's stored finish, one column on account
-- (2026-11-12).
--
-- Jamie, 2026-11-12 (DECISIONS "The welcome checklist finishes for
-- good"): "once finished, a stored flag hides the checklist for good".
-- Home's four welcome steps (G4) were worked out from state each time, so
-- an account that had done all four and then unfollowed everyone saw the
-- checklist come back at 3 of 4.
--
-- account.welcome_finished_at: when the account was first seen with all
-- four steps done. Stamped once by the first answer's read
-- (services/web-api/src/first-answer.mjs) with a conditional update that
-- touches only an unstamped row, and never cleared. Null means the
-- checklist is not finished. No backfill: an account that has already
-- done all four is stamped on its next Home read.
--
-- A nullable column with no default is catalog-only. It takes an ACCESS
-- EXCLUSIVE lock on account for an instant: fail fast rather than queue
-- sign-ins behind a long read, and let the deploy be retried.

set local lock_timeout = '5s';

alter table account add column welcome_finished_at timestamptz;

comment on column account.welcome_finished_at is
  '0246: when Home''s four welcome steps were first all done (2026-11-12). Set once by the first answer, never cleared; null means not finished. Hides the checklist for good.';
