-- 0284: web push's fifth kind, "Close friends' play".
--
-- Jamie, 2026-11-17: "overall the app doesn't have enough to bring
-- people back." Web push (0283) tells only what was done to you; this
-- kind tells the owner of a close mark (0281) when a starred friend
-- finished a session worth telling, or had a headline moment
-- (docs/notes/2026-11-17-close-friends-push.md).
--
-- The kind joins both kind checks: account_push_pref (a moved switch)
-- and push_notice (a notice told). Replacing a CHECK is a drop and an
-- add NOT VALID in one file (migration skill, shapes.md); both tables
-- are small and nothing old violates the wider list, so the VALIDATE is
-- left for a later file.
--
-- push_notice.told: for a close friends notice only, what it told, one
-- element per friend: {"tag", "sessions_through", "moments_through"}, the
-- end of the last session and the time of the last moment told of that
-- player. The drain reads it so a session is told once, never again when
-- it later grows, and a moment once. Null for every other kind. It names
-- only players the notice's own title and body already name, and it goes
-- with the notice (28 days, retention.mjs) and with the account.
--
-- claim_close: the drain's candidate read starts from the accounts with
-- a device and wants only their close marks; a partial index keeps that
-- read to the marks alone (few: a star is a handful per account).
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table account_push_pref
  drop constraint account_push_pref_kind_check,
  add constraint account_push_pref_kind_check
    check (kind in ('cheers', 'followers', 'clan_actions', 'answers',
                    'close_friends')) not valid;

alter table push_notice
  drop constraint push_notice_kind_check,
  add constraint push_notice_kind_check
    check (kind in ('cheers', 'followers', 'clan_actions', 'answers',
                    'close_friends')) not valid,
  add column told jsonb
    check (told is null or jsonb_typeof(told) = 'array');

comment on column push_notice.told is
  '0284: a close friends notice''s players and how far each was told ({tag, sessions_through, moments_through}); null for every other kind. Read only by the push drain.';

create index claim_close on claim (account_id) where close;
