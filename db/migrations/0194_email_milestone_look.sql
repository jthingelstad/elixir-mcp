-- 0194: the milestone mail remembers each account's last finished look.
--
-- The milestone job runs hourly and read a fixed 26-hour window ending
-- now (services/jobs/src/email/index.mjs, MILESTONE_LOOKBACK_MS). A run
-- that failed or was skipped for longer than that never read the moments
-- in the gap, so they were never mailed (issue #130, review follow-up
-- 2026-09-27). The window now runs 26 hours back from the account's last
-- look that finished cleanly (nothing new, or its mail sent), capped at
-- seven days; an account with no row reads the 26 hours it always did.
-- email_milestone still decides what is news, so a wider window never
-- mails a moment twice.
--
-- A new table: no existing table is altered or locked.
create table email_milestone_look (
  account_id uuid primary key references account on delete cascade,
  looked_at  timestamptz not null
);

comment on table email_milestone_look is
  'The instant of each account''s last milestone look that finished cleanly (0194). The next look reads from 26 hours before it, capped at seven days back; no row means the plain 26 hours.';
