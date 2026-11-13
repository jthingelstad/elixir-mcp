# Sent mail keeps a year

Jamie, 2026-11-13, agreeing to two recommendations put to him: "agree
with your recommednations".

- **`mail/sent/` expires at a year.** New archive bucket rules:
  - `mail-sent-expire`: `ExpirationInDays: 365`.
  - `mail-sent-purge-expired`: the noncurrent version a day after the
    delete marker, then the marker, as `calls/` and `payloads/` do.

  This matches the `email_issue` and `email_send` rows, which the
  retention trim keeps a year and which a sent mail's record is opened
  from. It makes email.md's "kept as it was sent for a year" true of the
  bodies too. No IAM change: S3 does the deleting.
- **The privacy page** says captured call bodies go "within 28 days"
  (was 90), matching the `calls-expire` rule since #937. Nothing else on
  the page changed.
- **Guard.** `services/jobs/test/retention.test.mjs` pins the `payloads/`
  and `mail/sent/` expiry at 365 days and each purge rule beside it.
- **Unchanged.** Account removal still lists sent-mail keys to delete by
  hand (`mail_archive_keys`); the lifecycle rule is the floor, not a
  substitute for removing a person's mail sooner.
