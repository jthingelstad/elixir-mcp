# Call captures follow the 28-day call log

Follow-up to the retention trim (#934), from Codex's finding on it.

- **What was wrong.** The trim deletes an `mcp_call_audit` row at 28
  days. The call record page finds a captured body only through that row
  (`services/web-api/src/call-record.mjs`), so from day 28 a body was
  unreachable, while the site and the app still promised 90 days.
- **The S3 objects.** They were never orphaned forever: the archive
  bucket's `calls-expire` lifecycle rule expired them at 90 days and
  `calls-purge-expired` removes the noncurrent version a day later. They
  would have sat unreachable from day 28 to day 91. `calls-expire` now
  expires at 28 days, so a body goes with its row. Its IA transition is
  removed (it needs 30 days). No IAM change: nothing deletes objects
  itself; S3 does.
- **Guard.** `services/jobs/test/retention.test.mjs` holds the
  `calls-expire` days equal to the call log's window.
- **Promises.** `limits.md`, Logs and CallRecord say 28 days. The lead
  decided this from Jamie's "Operational logs i would keep for 28 days",
  given for the MCP call audit by name. The privacy page's "captured
  call bodies within 90 days" is left for Jamie (legal lines change only
  with his word).
- **Sweeps [engineering].**
  - Removed: the 90-day `args` nulling and the 90-day `captured` flag
    flip. A row that old exists only if the trim failed, and the trim's
    next run deletes it; the body is gone from S3 by then.
  - Kept: the 30-day address scrub. It normally finds nothing; it is
    the backstop for rows the trim has not reached yet (its daily caps
    while a backlog drains, or a failed run), and the address is the one
    field with a promised clock of its own.
- **Not done.** Captures already older than 28 days in S3 go at the
  first lifecycle run after the deploy.

## The payload archive keeps a year

Jamie, 2026-11-13: "yes to 1 year retention on s3 payloaad archive too".

- `payloads-to-ia` gains `ExpirationInDays: 365`, and a new
  `payloads-purge-expired` removes the noncurrent version a day after the
  delete marker, then the marker (as `calls/`), so nothing waits another
  year under `expire-superseded-versions`.
- The bucket's protections, from the template: versioning on,
  `DeletionPolicy: Retain`, no Object Lock, and `ArchiveBucketPolicy`
  denying a `payloads/` put without `If-None-Match`. That policy governs
  principals' writes; lifecycle expiry is S3's own and is not affected.
  No IAM change.
- An unchanged payload is not rewritten, so its object goes a year after
  it was first archived even if the same content is still being fetched.
  A rebuild from the archive reaches back a year.
- DECISIONS, ENGINEERING, the record brief, architecture, limits and the
  skills that said "kept forever" now say a year.

## Privacy and mail pages

Jamie approved the four privacy replacements and the mail page's "for a
year" as proposed on #934; nothing else on those pages changed.

