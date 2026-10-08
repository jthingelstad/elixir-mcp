# Elixir Operator

_Formerly Run Elixir MCP (renamed 2026-09-29)._

Own the outcome: **the recorder pipeline is healthy end to end, and its
cost is visible and intended.** Battles observed in the game become rows
in the record within minutes; collectors heartbeat; the job ledger
drains; both doors (MCP and web) serve; nothing fails silently — and when something
does fail, this owner finds it before a user or the capture audit does.

## Every run

Establish, with receipts:

- **Pipeline verdict.** `GET https://elixir.poapkings.com/api/public/status`
  (the console's `/console/status` page is signed-in; this endpoint and `/data/now`
  are the public health reads) — health verdict, last admission age,
  battles last hour, the job ledger (`queue`: due, queued, leased, done
  this hour; `jobs.dead`), `health.dlq_messages`, and capture-audit 24h
  gaps/polls. Collector work has no queues since 0040: it lives in the
  Postgres job ledger, and a job that exhausts its five leases is `dead`.
  The email outbox DLQ is `elixir-mcp-email-dlq`; `dlq_messages`
  counts email objects still in the bucket past their last retry (15 min). A dead job or a dead letter is an incident, not a curiosity.
- **Collector fleet.** The DB-backed collector status is the fleet-health
  source of truth: inspect each collector's `status`, last heartbeat, last
  successful admission, and recent fetch count on the public Status page and
  in the Admin gateways view. The former per-gateway CloudWatch metrics were
  removed with the zero-trust collector door. A silent collector is degraded
  redundancy even while the other one carries the load. A `pending` collector
  that should be live (its operator finished setup) is a follow-up, not a
  shrug. Since 2026-09-11 collectors CHECK IN (the door says
  `next_check_in_s`: 0 while work remains, 15 s idle) instead of
  long-polling, so an active collector's heartbeat is never more than
  about a minute old; older than that is a collector not checking in.
  The Admin fleet table's three numbers are the efficiency read: yield 24h
  (share of fetches that changed the record; 55–80% is normal, a
  collector far below the others is fetching the wrong things), edge
  filter (share of battle-log entries dropped before the wire; ~85–90%),
  and calls/fetch (door calls per admitted fetch's lease-and-submit pair
  this hour; 1.0 is perfect, idle check-ins raise it). Attribute
  collector-door pressure with the collector Lambda's route
  logs (`/aws/lambda/elixir-mcp-collector` since 2026-09-29; the web-api's
  before), not a fixed calls/fetch target: a productive fetch produces a submit
  and normally another lease, while an idle collector produces leases without
  submits on its phased check-in. Escalate a sustained lease surplus that
  cannot be explained by submissions and the active fleet's idle cadence.
- **Yield and budget.** Migrate lambda `{stats: true}` — its
  `battlelog_filter_last_hour` (`nothing_new` is the polls that found
  nothing unrecorded, `gaps` the ones whose whole log was new; under the
  session clock since 2026-09-19 an empty read doubles the wait up to the
  2 h ceiling, so read `nothing_new` beside the Efficiency page's lost
  battles, never as a number to push down), the public status
  budget line (`useful_hour / measured_hour`: how much of the hour's
  spend changed the record), and the status endpoint's `queue` (due,
  queued, leased, done this hour).
  **Do not run `{probe: true}` as a routine check**: it is the heaviest
  read the migrate lambda has (bounded to 24 h since 2026-09-11, but
  thirteen unbounded runs in 25 minutes preceded the 14:02Z RDS memory
  recovery that day). It is an on-demand census; if you need it, run it
  once and never retry on `TooManyRequestsException`. The whole fleet
  must stay within roughly one API key's budget — that is ToS posture,
  never an optimization target to raise.
- **Scheduled jobs.** The jobs lambda's work happened: the nightly
  activity row (05:30Z) and efficiency row (05:20Z, `{capture_efficiency}`;
  yesterday's `lost_battles` in `capture_efficiency_daily`, which the
  console's Efficiency page reads) ran, Monday's sweeps ran (CloudWatch logs
  `/aws/lambda/elixir-mcp-jobs`). The nightly activity log also carries
  `archetype_stamp`: decks re-stamped when the descriptive grammar or
  vocabulary changes. A non-zero `written` with no vocabulary change or
  deploy that day needs investigation. The hourly operational sweep
  carries the factual war calendar health read. Global meta rollups and
  their equivalence operations are retired.
- **Doors.** MCP and web-api error alarms quiet; both p95 latency
  alarms quiet; `elixir-mcp-door-handled-failures` quiet (it counts the
  failures the doors answer themselves: `tool_failed_unexpectedly` and
  `db_connect_failed`, which no Lambda error sees); OAuth discovery
  serving (the deploy smoke checks these — a run after a deploy
  re-verifies with reads). The database's `elixir-mcp-db-ebs-byte-balance`
  and `elixir-mcp-db-freeable-memory` quiet, and
  `elixir-mcp-site-certificate-expiry` (ACM renewal depends on the
  validation CNAME at Namecheap, which only Jamie can fix). Which
  statements spend the database's time and reads is `{statements}`. `elixir-mcp-migrate-duration`
  quiet: it fires when a migrate invocation runs past 90 s, which means
  someone ran a diagnostics op against production — find who and why.
- **The acceptance suite, once a day.** `npm run acceptance` (read-only,
  the `acceptance` agent principal, `acceptance/.env` on the operator
  machine): the live invariants the deploy gate checks, re-checked
  between deploys, since the record moves without one - a note that
  names a field no row carries, two tools disagreeing on one number, a
  heavy call creeping toward the 18 s budget. A red case is a finding
  for Elixir Feedback Manager (product) or this objective (capacity: the
  `budgets` suite), never re-run until green.
- **Discord preview.** Own operational acceptance of `../elixir-mcp-discord`:
  managed service `com.poapkings.elixir-mcp-discord`, its existing run ledger,
  event cursor freshness, correct principal/contract version, both configured
  budget lanes and their refusal evidence, and feedback delivery. Use bounded
  natural logs and existing state. Coordinate host service faults with Run
  Operations; follow the preview's own instructions for any source change.
  Do not restart merely for changed prompts, run a routine early, replay a
  backlog, or add local game data/fallback to hide an upstream limitation.
  Elixir Feedback Manager owns the resulting tool-friction and answer-quality findings.
- **Cost.** No billing alarm (the account-wide one was removed
  2026-09-24; Jamie reads spend himself). RDS storage headroom
  (autoscaling floor 20GB, max 100GB); the web-api and collector Lambdas'
  billed seconds per day, attributed in Logs Insights by `http` route. Productive
  collector throughput legitimately scales both `POST /api/collector/lease`
  and `POST /api/collector/submit`; idle check-ins add leases. A fixed
  daily Lambda-seconds target is not a polling detector. Investigate an
  unexplained lease-to-submit surplus, long lease latency, or rising billed
  time with stable admissions instead; RDS `FreeableMemory` /
  `SwapUsage`, `EBSByteBalance%` and the Enhanced Monitoring OS split
  (on since 2026-09-11). The database is db.t4g.micro again since
  2026-10-08 (small from 2026-09-23 until the tracked-only correction
  shrank the record). The micro's limit is EBS byte balance: a heavy
  batch, a Gym sweep or a full acceptance gate can drain it, so space them. Anything trending that would
  surprise Jamie at the bill.

## Action

- Drain-and-diagnose a dead letter in the same run. The outbox object
  is the message (the DLQ holds only S3's notification pointing at it):
  read the object still in `elixir-mcp-outbox-<account>` under its lane
  (`email/`) and the worker's log for why it failed, fix at
  the source, and only then redrive the DLQ so the worker reads the
  object again. Objects and DLQ messages live 14 days. Never delete an
  outbox object unexamined; a successful worker deletes its own. A
  `dead` ledger job (the collector path's DLQ; `jobs.dead` on the status
  endpoint) is read with the migrate lambda's `{ledger: {op: "dead"}}`
  (the job and the collector that last held it), fixed at the seam that
  refused it, and only then requeued by name
  (`{ledger: {op: "requeue", job_ids: [...]}}`), or folded when a twin
  already carries the same work. Never sweep every historical failure.
- A stopped or breaker-open collector: diagnose from the status
  endpoint's collector rows, the Admin gateways view and the collector
  repo's expectations; if the fix is operator-side (a machine
  down at Jamie's house or the cabin), write the precise ask in NOTES
  rather than blocking.
- **Incident authority for three write ops (Jamie, 2026-09-25)**, only
  while the door or the pipeline is failing, each use written into NOTES
  with its evidence:
  - `{terminate_backends}` on a migration or backfill backend that has
    held its query for more than five minutes (the 0099 incident held a
    lock for about 35). Read `{backends}` first and name that query in
    `like` (the op refuses `true` and a pattern naming no query, and
    will not touch a backend younger than 300 s), and pass the
    `application_name` `{backends}` shows for it, because every service
    connects as the same database user and a loose pattern ends live
    door queries.
  - `{gateway_drain}` for a collector submitting errors or bad data, and
    `{gateway_recover}` once its fix is confirmed.

  Every other write op without a runbook grant (the `{account_*}` ops, `{oauth_grants}`) stays Jamie's: they change
  people's accounts.
- Transient upstream failures with held cursors self-heal — report and
  watch, don't churn. (The awareness-tick triage rule from elixir-bot
  applies here unchanged.)
- Deploys are part of this objective: a fix that is committed but not
  deployed is not shipped. `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs`,
  with `--acceptance=<family>` whenever a tool in that family changed.
  Acceptance is opt-in per deploy and `deploy.mjs` prints a WARNING when
  it is skipped; the whole suite (`--acceptance`) is for shared code
  (protocol, `tools.mjs`, `shared.mjs`, ingest) or a release, because a
  full gate on every deploy drained the database's EBS byte balance on
  2026-09-23.
- **A long batch against a Lambda blocks everyone else's deploy, so it
  holds the lease.** `elixir-mcp-migrate` and
  `elixir-mcp-jobs` both run at `ReservedConcurrentExecutions: 1`, so a
  backfill or repair looping invocations holds the whole function: a
  deploy's migration step answers
  `ReservedFunctionConcurrentInvocationLimitExceeded` (429) and the
  deploy stops there: the migrate function's new bundle is in place, the
  stack has not flipped. Seen twice on
  2026-09-22, both self-inflicted, when the lease guarded the checkout and
  a batch ran with it released. Since 2026-09-29 the lease guards deploys
  and ops-lambda writes, so a batch holds it for its whole run and the next
  deployer reads who and since when instead of a 429. Say in NOTES when a
  long batch is running and roughly when it ends; prefer a resumable op with a real remaining
  count so anyone can tell done from stuck.
- **Quarterly** (and after any schema-shape change to the account
  tables): rehearse restore. Restore the latest RDS snapshot to a
  scratch instance, run the schema fingerprint against it, time the
  procedure, write the steps and timing into `docs/NOTES.md`. Record the
  last successful rehearsal, snapshot/source age, next quarterly due date,
  schema revision, acceptance result and cleanup evidence. Unknown prior
  success is due for review, never presumed complete. Check the receipt
  before retrying; a schema change can make a new rehearsal due sooner.
  Name and cost-bound the scratch instance before creation; confirm its
  deletion after the test without touching retained production snapshots.
  Recover Projects owns the host/project backup inventory and checks this
  RDS receipt as a separate coverage item. Backups that have never restored
  are hypotheses.

## Success

The pipeline verdict is green and *explained* — the run can say why each
number is what it is. No dead jobs or dead letters, or their contents
are understood and fixed. The fleet's health matches what the Status page tells the
public. Cost is boring. A healthy no-op run ends with one line in the
notes and no commits.


## Consolidated Clan responsibility

Clan operation belongs to this owner: Clan is part of Elixir, with no separate runtime or owner.

Read the private policy-clan inventory through `{clan_maintenance:{lane:"clans"}}`, following next_cursor to completion. Inspect bounded `{clan_maintenance:{lane:"morning",clan_tag}}` receipts for completion, attempts and failures, plus the shared morning job logs and mail delivery receipts. Distinguish quiet/no-policy clans from failed evaluation, and uncertain paid-model attempts from a retryable job. Never repeat a paid call for verification.
