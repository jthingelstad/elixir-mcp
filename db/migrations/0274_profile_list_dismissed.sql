-- 0274: Home's profile list can be put away by an account that had
-- finished the older welcome list (2026-11-14, #1015).
--
-- docs/product/stamps.md, "One profile list": an account that finished
-- Home's older four-step welcome (account.welcome_finished_at, 0246)
-- is offered only the six-step list's remaining steps, and can dismiss
-- it. The dismissal is the account's, not the browser's: it holds on
-- every device, as the starter set's Not now does (0264).
--
-- account_profile_list.dismissed_at: when the person dismissed the
-- list. Null means not dismissed. Set once by POST
-- /api/me/passport/dismiss and never cleared; it hides the list and
-- changes nothing else: no step latches, the list is not complete, and
-- All Set is not granted by it.
--
-- A nullable column with no default on a new, small table:
-- catalog-only. The ALTER takes an ACCESS EXCLUSIVE lock on
-- account_profile_list for an instant: fail fast rather than queue
-- passport reads behind it.

set local lock_timeout = '5s';

alter table account_profile_list add column dismissed_at timestamptz;

comment on column account_profile_list.dismissed_at is
  '0274: when the person dismissed Home''s profile list (offered only to an account that finished the older welcome list). Hides the list; never completes it or grants All Set. Set once, never cleared.';
