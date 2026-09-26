# Run Elixir MCP — acceptance transport bounded

## Evidence

- Preflight was observation-available and mutation-eligible; lease
  `5d137981-a6de-430e-93b4-f656736cd43b` protected this run's edits.
- Public status at 09:46Z: healthy, fetch/admission age 197 seconds, 808
  battles/hour, no queued or dead jobs, no DLQ messages, and five fresh active
  collectors. The 24-hour capture audit had 11 gaps in 19,187 polls.
- Migrate `{stats:true}`: 735 trailing-hour battle-log polls, one gap, and 20
  trailing-day upstream 404/transport receipts; no current fetch error. Jobs
  completed the 05:20Z efficiency, 05:30Z activity and 04:42Z nightly rollup.
- No Elixir alarm was in `ALARM`; RDS had 515-705 MiB freeable memory, about
  15-16 MiB swap, and 99% EBS byte balance. Tagged September 1-25 Cost Explorer
  spend was $1.1354319506. OAuth discovery served and bearerless MCP was 401.
- All three Discord preview launchd instances were active. Their natural logs
  showed current contract-change notices and event-cursor consumption; no
  instance was restarted or prompted.

## Finding and correction

`npm run acceptance` began normally but one request stayed open beyond four
minutes. The old client supplied no fetch deadline, so its read-only process was
terminated. The acceptance door now aborts at 20 seconds (above the 18-second
analytical budget), with a regression test for a stalled fetch. The daily suite
was deliberately not repeated after the failure.

`node --test acceptance/acceptance.test.mjs` and `npm run verify` passed. This
changes the local/deploy acceptance harness only; no production deployment is
owed. The next normal acceptance pass should confirm that a stalled request is
reported as a failure rather than hanging.
