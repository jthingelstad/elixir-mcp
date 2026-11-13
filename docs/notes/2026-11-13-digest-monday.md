# 2026-11-13 — The digest comes Monday, right after the weekly reset

Jamie, 2026-11-13: "that email should move to Monday", "it should be sent
right after the weekly reset". The digest's rule (`EmailTrackingReportRule`
in `infra/template.yaml`) now fires daily at 11:00 UTC instead of 14:30,
`MAIL_SCHEDULE.tracking_report` follows it (pinned to the cron by
`packages/mail/test/mail.test.mjs`), and `DIGEST_WEEKLY_DAY` in
`services/jobs/src/email/index.mjs` is Monday (1), not Wednesday (3).
Daily readers move to 11:00 UTC with it, since one rule serves both.

Why 11:00 and not 10:00: the game's weekly reset is Monday 10:00 UTC
(`WEEK_RESET_HOURS`), and a river race closes about 09:40 UTC; an hour's
margin lets the race's close and the last sessions' battle logs be read
first (war-day race reads every 30 minutes, battle logs at most two
hours apart). The window (`digestWindow`) is unchanged: a week back,
starting no earlier than the last digest, so the first Monday digest
after a Wednesday one covers those five days and nothing is told twice.

**The switch week.** Before: one rule at 14:30 UTC daily, weekly readers
on Wednesday. After: one rule at 11:00 UTC daily, weekly readers on
Monday. Nothing is ever sent twice for one UTC day (the period key is the
date), and the window reaches back at most one span (a week, or a day)
to the last digest, so what the switch could cost is a gap, not a repeat:

- **Weekly readers** keep every day when the deploy lands between
  Wednesday 14:30 UTC (after that week's Wednesday digest) and Monday
  11:00 UTC: the first Monday digest starts at the Wednesday one, under
  five days back. A deploy from Monday 11:00 to Wednesday 14:30 makes the
  next Monday more than seven days after the last digest, and the days
  before the floor go untold.
- **Daily readers** keep every day when the deploy lands outside 11:00 to
  14:30 UTC: inside it, that day's 14:30 run no longer exists and its
  11:00 run has passed, so the next run is over a day after the last.
- Two digests in one week, never for the same days: a weekly reader whose
  Wednesday digest went out gets the next on Monday, covering only the
  days since.

So deploy between Wednesday 14:30 UTC and Monday 11:00 UTC, and not
between 11:00 and 14:30 UTC on any day (in US Central: Wednesday mid-day
to Monday early morning, avoiding the late-morning hours).

The footer's why-line, Settings › Emails and the docs read the time from
`MAIL_SCHEDULE`, so they follow. The DECISIONS digest line now says
Monday. The product brief `docs/product/mail.md` still says Wednesday;
DECISIONS steers until it is rewritten. MCP and the JSON API unchanged.
