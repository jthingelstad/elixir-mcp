-- 0267: Delete the email switches of the two removed mail kinds,
-- top_100 (Ultimate Champions) and card_of_week.
--
-- Jamie, 2026-11-14: "Remove those email kinds." The code no longer
-- knows either name: no send path, label, Settings row or switch. A
-- switch row for one is a setting for a mail that cannot be sent, read
-- by nothing (Settings lists only the active kinds; the digest's fold
-- reads only clan_report and arena_week), so it goes. At most one row
-- per account per kind.
--
-- What this does not touch: the sent-mail record (email_issue and its
-- email_send rows of these kinds) stays and still opens, under the
-- label "Retired email"; the retention trim takes it a year after it was
-- composed. Old unsubscribe links naming either kind land on the "This
-- email has ended" page and write nothing. account_event rows whose
-- detail names a kind are history and stay.
--
-- account_email_pref is small (one row per changed switch); the delete
-- holds row locks on those rows only. Fail fast rather than wait on a
-- person's switch being flipped.
--
-- vacuum after: account_email_pref

set local lock_timeout = '5s';

delete from account_email_pref where kind in ('top_100', 'card_of_week');
