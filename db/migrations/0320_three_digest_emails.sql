-- 0320: the digest becomes three emails, each with its own switch
-- (2026-11-26).
--
-- Jamie, 2026-11-26: "I am realizing that it isn't one email feature
-- that is either weekly or daily; it is actually three unique emails at
-- three different frequencies: Daily email that is a brief on what
-- happened yesterday, Weekly email aligns with weekly reset that recaps
-- the week, Season email that is sent on season rollover and recaps the
-- events from the season. I should be able to select all or none of
-- them."
--
-- Three kinds, three rows of account_email_pref: `digest_daily` (the
-- daily brief, off unless chosen), `tracking_report` (the weekly recap,
-- the digest's key since 2026-11-12, on by default) and `digest_season`
-- (the season recap, on by default). An absent row is the kind's
-- default (contracts emailKindDefault). The one choice 0242 stored
-- (cadence beside the tracking_report switch) moves to the switches, as
-- Jamie set out (keep the data, migrate, do not grandfather):
--
--   - Weekly, chosen or the default: weekly on, daily off, season on.
--     That is every kind's default, so no row is written.
--   - Daily (tracking_report on, cadence 'daily'): daily on, weekly off,
--     season on (its default, no row).
--   - Off (tracking_report off, whatever its cadence): all three off.
--
-- Each row written carries the tracking_report row's own `via` and
-- `changed_at`: it is the same person's choice, made when they made it,
-- so the profile list's email step (packages/stamps, which counts a
-- switch a person moved, via <> 'ops') and its launch snapshot (changed
-- before the Stamps launch) read exactly what they read before. The
-- tracking_report row of a daily reader is turned off in place, keeping
-- its via and changed_at for the same reason. Nothing already earned is
-- touched.
--
-- Order: the Off rows first (tracking_report already off), then the
-- daily readers' daily rows, then their weekly switch off. A reader
-- whose daily brief is on is never read as Off, so a second run writes
-- nothing.
--
-- account_email_pref.cadence is retired: the new code neither reads nor
-- writes it. Its values stay where they were until a later contract
-- migration drops the column; the old code serving while this commits
-- still reads it. account_profile_list.digest_choice is retired the same
-- way: the profile list's step now latches on any explicit email choice
-- and writes no choice of its own; the stored values are history.
--
-- The old code serving while this commits sends only tracking_report:
-- a daily reader whose weekly switch this turns off gets no digest from
-- it until the new code's daily brief, the next day at 11:00 UTC.
--
-- account_email_pref is small (one row per changed switch); fail fast
-- behind a person flipping one.
--
-- vacuum after: account_email_pref

set local lock_timeout = '5s';

insert into account_email_pref (account_id, kind, enabled, via, changed_at)
select p.account_id, k.kind, false, p.via, p.changed_at
  from account_email_pref p
 cross join (values ('digest_daily'), ('digest_season')) as k (kind)
 where p.kind = 'tracking_report' and not p.enabled
   and not exists (select 1 from account_email_pref d
                    where d.account_id = p.account_id
                      and d.kind = 'digest_daily' and d.enabled)
on conflict (account_id, kind) do nothing;

insert into account_email_pref (account_id, kind, enabled, via, changed_at)
select p.account_id, 'digest_daily', true, p.via, p.changed_at
  from account_email_pref p
 where p.kind = 'tracking_report' and p.enabled and p.cadence = 'daily'
on conflict (account_id, kind) do nothing;

update account_email_pref
   set enabled = false
 where kind = 'tracking_report' and enabled and cadence = 'daily';

comment on column account_email_pref.cadence is
  '0242, retired in 0320: the digest''s old how-often. Nothing reads or writes it; the three digests are three kinds with their own switches.';

comment on column account_profile_list.digest_choice is
  '0269, retired in 0320: the old digest choice. No longer written; the email step latches on any explicit email choice.';
