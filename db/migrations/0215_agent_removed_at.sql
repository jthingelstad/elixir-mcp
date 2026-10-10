-- 0215: an owner can remove a suspended agent from view without deleting it.
--
-- Jamie, 2026-10-10: five suspended agents on one account still filled the
-- console rail's selector and the Agents table. Agents are never deleted
-- (the account, its public_id URL, its keys and its history stay), so
-- "remove" is a mark: a removed agent leaves the rail and the main list and
-- waits in a collapsed Removed list on the Agents page, where Restore puts
-- it back among the suspended.
--
-- Only a suspended agent can be removed, and resuming one restores it, so
-- removed_at is set only while status = 'disabled' and every credential is
-- already refused by both doors. Nullable with no default: catalog-only.

set local lock_timeout = '5s';

alter table account add column removed_at timestamptz;

comment on column account.removed_at is
  'When the owner removed this suspended agent from view (0215). Null: shown. Set only while status is disabled; resuming or restoring clears it.';
