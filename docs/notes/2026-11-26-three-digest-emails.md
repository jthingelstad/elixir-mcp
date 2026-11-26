# 2026-11-26 — Three digest emails, each its own switch

Jamie, 2026-11-26: "it isn't one email feature that is either weekly or
daily; it is actually three unique emails at three different
frequencies ... I should be able to select all or none of them."

**What changed.** The digest's one choice (weekly, daily or off, the
`cadence` beside the `tracking_report` switch) became three kinds, each a
switch of its own in Settings › Emails and on the Timeline's "Your emails"
panel:

- `digest_daily`, the Daily brief: every day at 11:00 UTC, the day
  before. Off by default.
- `tracking_report`, the Weekly recap: Mondays at 11:00 UTC. The old
  digest's key, so its switch, opt-outs and old unsubscribe links carry
  over. On by default.
- `digest_season`, the Season recap: at 11:00 UTC on the day a season
  starts (the first Monday's 10:00 UTC reset, `seasonFromDate`), covering
  the season that closed. On by default.

One builder and one renderer serve all three, with the same readers and
rules (skip when empty; sessions learned a day or more late left out; no
model, rating or recommendations). Each kind has its own period key, its
own window and its own last send (`digestSlot`, `digestWindow`,
`lastDigests`). A rollover Monday sends all three a reader has on. The
clan news switch (`clan_report`, `PUT /api/me/email {clan_part}`) is one
for all three. Each footer link and one-click unsubscribe turns off its
own kind.

**Schedule.** Three EventBridge rules: `EmailDigestDailyRule` every day,
`EmailTrackingReportRule` and `EmailDigestSeasonRule` on Mondays, all at
11:00 UTC. The season rule fires every Monday and a scheduled run sends
only within a day of a season start; its period key is `S<closed season>`.

**Migration 0320** (`0320_three_digest_emails.sql`) moves the old choice:
Weekly or the default writes nothing (every kind's default); Daily writes
`digest_daily` on and turns `tracking_report` off; Off writes
`digest_daily` and `digest_season` off. Rows keep the person's `via` and
`changed_at`. The `cadence` and `account_profile_list.digest_choice`
columns are retired by comment and left for a later contract migration.

**Profile list.** The email step latches on any explicit email choice (a
digest row with `via <> 'ops'`, or a stored `digest_choice`); nothing
earned is revoked. `GET /api/me/first` carries `setup.emails`
(`chosen_at`, `daily`, `weekly`, `season`) in place of `setup.digest`.

**Engineering readings.** `tracking_report` stays the weekly key, so an
old daily mail's link turns off the weekly recap, which the migration had
already turned off for daily readers. `PUT /api/me/email` with kind `all`
settles the email step. The timeline cap per digest stays 2,000 items,
for the season recap too. No MCP contract moved.

**Left.** Dropping the `cadence` and `digest_choice` columns (a later
contract migration). `docs/design/passport/prototype.js` is a design
artifact and keeps its old wording.
