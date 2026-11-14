-- 0273: when an account's ladder history before launch was settled
-- (2026-11-14, #1015, follow-up to 0272).
--
-- 0272 files a ladder level as legacy when the stored facts dated before
-- launch reach it. The history the live paths never read (friendlies
-- older than the reconciliation's 30 days, highlights and cheers from
-- before launch) becomes facts only when the operator's
-- {passport_backfill} reads it. Until then a level a post-launch fact
-- completes could be granted as ordinary, a "New Stamp" line, for a level
-- the account had already earned before launch, and a grant is never
-- rewritten. So for an account made before launch, a ladder level that is
-- not legacy waits until this is set: the backfill sets it as it finishes
-- the account, and the account's next earning call grants what is left.
-- Setup Stamps do not wait (0272's legacy_settled_at covers them).
--
-- A nullable column with no default on a small table: catalog-only. The
-- ALTER takes an ACCESS EXCLUSIVE lock for an instant: fail fast rather
-- than queue passport reads behind it.

set local lock_timeout = '5s';

alter table account_passport add column legacy_history_at timestamptz;

comment on column account_passport.legacy_history_at is
  '0273: when the operator''s backfill settled the account''s ladder history before launch. Null on an account made before launch means its ordinary ladder grants wait; accounts made after launch never need it.';
