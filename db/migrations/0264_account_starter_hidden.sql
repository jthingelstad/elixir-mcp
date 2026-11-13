-- 0264: Home's suggested follows, put aside for 30 days, one column on
-- account (2026-11-13).
--
-- Jamie, 2026-11-13: "we should make sure that if someone isn't following
-- players (or a super small amount) that we should bring the suggested
-- user list even if it isn't their first login." Home offers the list to
-- any account following few players, on every visit; someone may follow
-- few on purpose, so the list has a quiet "Not now" [engineering,
-- 2026-11-13].
--
-- account.starter_hidden_at: when the person last chose "Not now". Home
-- leaves the list off its top for 30 days from it, then offers it again
-- while the account still follows few. Find always lists everyone. Null
-- means never put aside. No backfill.
--
-- A nullable column with no default is catalog-only. It takes an ACCESS
-- EXCLUSIVE lock on account for an instant: fail fast rather than queue
-- sign-ins behind a long read, and let the deploy be retried.

set local lock_timeout = '5s';

alter table account add column starter_hidden_at timestamptz;

comment on column account.starter_hidden_at is
  '0264: when the person last put Home''s suggested follows aside ("Not now", 2026-11-13). Home leaves them off its top for 30 days from it; null means never.';
