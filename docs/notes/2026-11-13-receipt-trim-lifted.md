# 2026-11-13 — The receipt trim runs

No MCP tool, `/api/v1` operation, contract version or migration changes;
what each reader answers is the same once the backfill is done.
Production rows change: the daily retention trim (jobs, 04:40Z) now
deletes receipts older than 28 days, in its bounded batches.

Jamie, 2026-11-13: "Operational logs i would keep for 28 days".
`api_receipt` was declared at 28 days and held until no reader looked
further back. 0259 (`2026-11-13-receipt-readers.md`) added read facts
kept a year, written at ingest and filled by `{read_facts_backfill}`.
This change moves the four long readers onto them and removes the hold. It
deploys only after `{read_facts_backfill}` has run to `done` in production
and `{read_facts_check}` reads every `missing_*` as 0, never in the same
deploy as 0259. [engineering]

- **The readers move onto the facts** (held back from #942 by #943, the
  expand step): role history and the reads around each finish
  (`participation-sql.mjs`), war award absence evidence
  (`war-membership.mjs`), the event calendar's read days (`game_events`)
  and `days_since_poll` (`activity/entries.mjs`). `days_since_poll` now
  counts admitted battle-log reads only; a rejected read is no poll.
  `receipt-readers.test.mjs` drops their pins and requires that none of
  the four names `api_receipt`.
- `packages/record/src/retention.mjs`: the `api_receipt` entry has no
  `held`. The mechanism stays for a later entry.
- `services/jobs/test/retention.test.mjs`: no entry is held, and the first
  trim takes the audit row before its receipt.
- `public-stats.mjs`: its comment says the trim runs. The public fetch
  series covers the 28 days held, and recounts in full after each trim
  that deletes.

What the trim changes for readers is in the 0259 note's last section: the
collector page's 30-day series shows 28 days, the public fetch series
covers 28 days, and `{funnel}`'s first profile read falls back to the
first battle stored.

The first runs delete about 200 MB of receipts across several days. A
`{vacuum}` of `api_receipt` afterwards returns the space to the table,
not the disk.
