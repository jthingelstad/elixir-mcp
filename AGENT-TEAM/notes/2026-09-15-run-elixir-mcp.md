# Run Elixir MCP — 2026-09-15

## 21:48Z — Recorder healthy; preview read-only-channel selector repaired

- **Production receipts:** public status at 21:48Z was healthy: admissions/fetches
  32 seconds old, 929 battles in the hour, queues and DLQs empty, five active
  collectors, and 278 useful of 429 measured hourly requests. Migrate
  `{stats:true}` reported 300 battle-log polls (172 nothing-new, four capture
  gaps); 808 24-hour fetch errors remain the known board/race 404 watch
  (640 `rankings_pol`, 161 `currentriverrace`), plus six player 404s and one
  transport error. All 15 Elixir alarms were `OK`; the private encrypted
  db.t4g.micro remained available with 20–100 GB storage autoscaling.
- **Cost and scheduled work:** the nightly activity histogram completed at
  05:30Z (748 players, 6.7 seconds). Scheduler `PlannedJobs` was 426–596 per
  hour across the sampled hours. Web-api usage recovered after the earlier
  incident to 193–256 Lambda-seconds/hour (1,757–2,380 invocations/hour).
  Recent RDS samples held 123–147 MiB freeable memory and 29–30 MiB swap.
- **Preview gap and fix:** POAP KINGS boot logs showed `hello_failed: Missing
  Permissions` after a new read-only `#elixir` directory entry sorted before
  writable channels. This was a runner selector defect, not a channel outage:
  the active ask channel passed permission checks and all three preview probes
  authenticated as the correct agent on contract 3.7.0 with current cursors
  and zero pending feedback. Commit
  `eef3a995bd190a9e590a14f48d747f05dac91c5d` in
  `jthingelstad/elixir-mcp-discord` centralizes writable-directory selection
  for boot banners, feedback delivery and operator wording; it adds regression
  coverage for read-only entries. `npm run verify` passed (162 tests; existing
  non-failing Knip configuration hints only), the commit was pushed, and the
  POAP KINGS, Ship It!, and Elixir Kings launchd services were restarted one
  at a time. Each booted build `0.3.0+eef3a99`, authenticated to 3.7.0, passed
  its channel check, and posted its startup banner to a writable channel.
- **Continuing watches:** retain Keep the Boards' 127/262 regional-freshness
  watch and Keep the Record True's capture-gap watch. Skeleton Army is still
  healthy but reports `py-dev`; do not restart it without an operator/version
  decision. Natural preview budget-refusal evidence remains absent and was not
  manufactured.
