# Run Elixir MCP

Own the outcome: **the recorder pipeline is healthy end to end, and its
cost is visible and intended.** Battles observed in the game become rows
in the record within minutes; collectors heartbeat; queues drain; both
doors (MCP and web) serve; nothing fails silently — and when something
does fail, this owner finds it before a user or the capture audit does.

## Every run

Establish, with receipts:

- **Pipeline verdict.** `GET https://elixir.poapkings.com/api/public/status`
  — health verdict, last admission age, battles last hour, every queue's
  depth/in-flight, all four DLQs (any DLQ > 0 is an incident, not a
  curiosity), capture-audit 24h gaps/polls.
- **Collector fleet.** CloudWatch `ElixirMCP/Gateway/<name>` Heartbeat /
  FetchSucceeded / BreakerOpen per collector; the Admin gateways view.
  A silent collector is degraded redundancy even while the other one
  carries the load. A `pending` collector that should be live (its
  operator finished setup) is a follow-up, not a shrug.
- **Yield and budget.** Migrate lambda `{probe: true}` (48h fetch/harvest
  census; battlelog fetches vs battles harvested) and `{stats: true}`.
  The whole fleet must stay within roughly one API key's budget — that
  is ToS posture, never an optimization target to raise.
- **Scheduled jobs.** The jobs lambda's work happened: yesterday's
  `clan_pulse` emitted (event_feed has today's rows), Monday's sweeps
  ran (CloudWatch logs `/aws/lambda/elixir-mcp-jobs`).
- **Doors.** MCP and web-api error alarms quiet; p95 latency alarm
  quiet; OAuth discovery serving (the deploy smoke checks these — a run
  after a deploy re-verifies with reads).
- **Cost.** The monthly cost alarm state; RDS storage headroom
  (autoscaling floor 20GB, max 100GB); anything trending that would
  surprise Jamie at the bill.

## Action

- Drain-and-diagnose a non-empty DLQ in the same run: read the messages
  (they are receipts), find the rejecting seam, fix at the source, and
  only then redrive. Never delete a DLQ message unexamined.
- A stopped or breaker-open collector: diagnose from metrics and the
  collector repo's expectations; if the fix is operator-side (a machine
  down at Jamie's house or the cabin), write the precise ask in NOTES
  rather than blocking.
- Transient upstream failures with held cursors self-heal — report and
  watch, don't churn. (The awareness-tick triage rule from elixir-bot
  applies here unchanged.)
- Deploys are part of this objective: a fix that is committed but not
  deployed is not shipped. `AWS_PROFILE=jamie node infra/scripts/deploy.mjs`.
- **Quarterly** (and after any schema-shape change to the account
  tables): rehearse restore. Restore the latest RDS snapshot to a
  scratch instance, run the schema fingerprint against it, time the
  procedure, write the steps and timing into `docs/NOTES.md`. Backups
  that have never restored are hypotheses.

## Success

The pipeline verdict is green and *explained* — the run can say why each
number is what it is. DLQs are empty or their contents are understood
and fixed. The fleet's health matches what the Status page tells the
public. Cost is boring. A healthy no-op run ends with one line in the
notes and no commits.
