-- An approved account should already be tracking what it asked for.
--
-- The access request has carried requested_player_tag since the gate shipped,
-- and nothing ever read it: approval flipped a status, and the new arrival
-- signed in to an empty console and had to type in the tag they had already
-- given us. So approval now claims that player and tracks their clan.
--
-- This stamp makes it happen ONCE. The clan is the reason it is a column and
-- not just a step: at approval we may never have fetched the player, so we do
-- not yet know which clan they are in. Leaving the stamp null lets the next
-- sign-in finish the job, and setting it the moment we know (clan added, or
-- the player observed and in no clan) stops us from re-adding a clan the
-- account holder has since removed on purpose.
alter table account add column onboarded_at timestamptz;

comment on column account.onboarded_at is
  'Set when approval-time tracking finished for this account: the requested player claimed, and their clan tracked or known not to exist. Null means a sign-in should try again.';
