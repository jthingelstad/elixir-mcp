# Run Elixir MCP — 2026-09-14

## Operational evidence and collector-result repair

- **Preflight (13:43Z):** observation available and mutation eligible; clean,
  synchronized `main`, no queued notes. The public status read was green:
  19-second fetch/admission freshness, 854 battles in the prior hour, no queue,
  dead-job, or DLQ work, and five active collectors with 59.5-63.4% 24-hour
  yield and 88.8-91.7% edge filtering. The global budget had used 408 of 3,600
  measured requests, with 231 useful.
- **Pipeline and cost:** migrate `{stats:true}` reported 358 battle-log polls
  in the hour, 10,151 entries filtered before the wire, 242 nothing-new polls
  and six capture gaps. All 15 Elixir MCP alarms were OK; the stack was
  `UPDATE_COMPLETE`; RDS was available on encrypted `db.t4g.micro` with
  20-100 GB autoscaling. In the latest two hourly points, minimum
  FreeableMemory was 116-122 MiB and maximum SwapUsage was 27.5-27.6 MiB. The
  preceding full-day web-api duration was 5,126 Lambda-seconds; the monthly
  estimate was $24.10. OAuth discovery returned 200 and an unauthenticated MCP
  request correctly returned 401.
- **Preview:** all three launchd instances were running, authenticated as
  agents on contract 3.1.0, with fresh `clan-feed` cursors at 13:41Z, no channel
  problems, and routine/ask spend below their configured $20/$10 lanes. POAP
  KINGS retains five answered-feedback receipts; Ship It! and Elixir Kings
  have no answered feedback yet. No prompt reload, restart, routine, or replay
  was triggered.
- **Measured gap:** `stats` still reported 123/262 regional Path of Legends
  locations fresh after the 10:00Z wave, even though the scheduler planned 270
  jobs. Collector errors had no durable outcome record, so neither the public
  status nor the operations reader could distinguish non-200 upstream results
  from collector-side failure.
- **Repair:** migration 0090 adds a seven-day, payload-free
  `collector_fetch_error` operational receipt. Ingest writes one for each
  validated non-200 result without changing admission freshness; `{stats:true}`
  groups the last 24 hours by endpoint, HTTP status and error kind; the hourly
  operational sweep expires it after seven days. No collector release is
  needed. Targeted ingest, jobs and migrate suites passed.
- **Deployment and acceptance (13:55Z):** `7b2ab5a` passed the full repository
  gate, migration 0090 applied, and the stack reached `UPDATE_COMPLETE`.
  Deployment smoke re-verified the OAuth/MCP door, status, CSP, corpus,
  registry and site paths. A live read-only `{stats:true}` returned an empty
  `fetch_errors_24h` aggregate; this confirms the deployed reader shape but
  does not manufacture an error. The next natural daily board wave is the
  acceptance watch for attributing the still-stale regional locations.

## Natural receipt acceptance — 17:47Z

- The first natural error receipt is now attributable without a payload read:
  `{stats:true}` held steady at 133 upstream HTTP 404 outcomes — 104
  `rankings_pol`, 27 `currentriverrace`, and two `player` — with no transport,
  overflow, breaker, queue, leased-job, dead-job, DLQ, collector-heartbeat, or
  alarm failure. The 104 ranked-board refusals explain most, but not all, of
  the 139 stale regional locations; Keep the Boards owns the remaining
  coverage diagnosis at the next natural 10:00Z wave.
- The recorder remains healthy: five active collectors had 116-second
  fetch/admission freshness at the closer read, 969 battles in the prior hour,
  437/3,600 measured budget use (289 useful), and 97 gaps in 6,886 rolling-day
  battle-log polls. All three Discord preview agents were running on contract
  3.1.0 with fresh cursors and no channel problems. No source, collector,
  restart, replay, or deployment action was warranted.
