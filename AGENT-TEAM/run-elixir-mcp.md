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
  and edge filter. Attribute collector-door pressure with the web-api route
  logs, not a fixed calls/fetch target: a productive fetch produces a submit
  and normally another lease, while an idle collector produces leases without
  submits on its phased check-in. Escalate a sustained lease surplus that
  cannot be explained by submissions and the active fleet's idle cadence.
- **Yield and budget.** Migrate lambda `{stats: true}` — its
  `battlelog_filter_last_hour` (`nothing_new` was 55–61% of polls before
  the roster gate; watch it fall, and watch `gaps`), the public status
  budget line (`useful_hour / measured_hour`: how much of the hour's
  spend changed the record), and `ElixirMCP/Ledger PlannedJobs` per hour.
  **Do not run `{probe: true}` as a routine check**: it is the heaviest
  read the migrate lambda has (bounded to 24 h since 2026-09-11, but
  thirteen unbounded runs in 25 minutes preceded the 14:02Z RDS memory
  recovery that day). It is an on-demand census; if you need it, run it
  once and never retry on `TooManyRequestsException`. The whole fleet
  must stay within roughly one API key's budget — that is ToS posture,
  never an optimization target to raise.
- **Scheduled jobs.** The jobs lambda's work happened: the nightly
  activity row (05:30Z) and efficiency row (05:20Z, `{capture_efficiency}`;
  yesterday's `LostBattles` on the dashboard) ran, Monday's sweeps ran (CloudWatch logs
  `/aws/lambda/elixir-mcp-jobs`). The 04:40Z meta rollup's log line
  carries `phases`: since 0140 (2026-09-19) `pop_days` is the days not
  yet sealed, seconds on an ordinary night (10 s on day 12 of
  September); the ten aggregates scale with the season and were ~200 s
  that day, so a run past ~500 s mid-season is the thing to read. The
  The same nightly log line carries `archetype_stamp` (since 0148): the
  decks re-stamped because the grammar or the vocabulary moved, and the
  version they were stamped under - `written` is 0 on an ordinary night
  and the whole table (~205k, about two minutes) the night after a
  vocabulary import or a grammar bump; a non-zero `written` with no
  deploy that day is the thing to read. The
  proof that the population table matches the raw rows is
  `{meta_rollup_equivalence: true}` on the jobs lambda (rolled back,
  about five minutes on the micro, `hourly_ran` says whether the :45
  increment moved the counters meanwhile); not a routine check.
- **Doors.** MCP and web-api error alarms quiet; p95 latency alarm
  quiet; OAuth discovery serving (the deploy smoke checks these — a run
  after a deploy re-verifies with reads). `elixir-mcp-migrate-duration`
  quiet: it fires when a migrate invocation runs past 90 s, which means
  someone ran a diagnostics op against production — find who and why.
- **The acceptance suite, once a day.** `npm run acceptance` (read-only,
  the `acceptance` agent principal, `acceptance/.env` on the operator
  machine): the live invariants the deploy gate checks, re-checked
  between deploys, since the record moves without one - a note that
  names a field no row carries, two tools disagreeing on one number, a
  heavy call creeping toward the 18 s budget. A red case is a finding
  for Close the Loop (product) or this objective (capacity: the
  `budgets` suite), never re-run until green.
- **Discord preview.** Own operational acceptance of `../elixir-mcp-discord`:
  managed service `com.poapkings.elixir-mcp-discord`, its existing run ledger,
  event cursor freshness, correct principal/contract version, both configured
  budget lanes and their refusal evidence, and feedback delivery. Use bounded
  natural logs and existing state. Coordinate host service faults with Run
  Operations; follow the preview's own instructions for any source change.
  Do not restart merely for changed prompts, run a routine early, replay a
  backlog, or add local game data/fallback to hide an upstream limitation.
  Close the Loop owns the resulting tool-friction and answer-quality findings.
- **Cost.** The monthly cost alarm state; RDS storage headroom
  (autoscaling floor 20GB, max 100GB); the web-api Lambda's billed
  seconds per day, attributed in Logs Insights by `http` route. Productive
  collector throughput legitimately scales both `POST /api/collector/lease`
  and `POST /api/collector/submit`; idle check-ins add leases. A fixed
  daily Lambda-seconds target is not a polling detector. Investigate an
  unexplained lease-to-submit surplus, long lease latency, or rising billed
  time with stable admissions instead; RDS `FreeableMemory` /
  `SwapUsage` and the Enhanced Monitoring OS split (on since
  2026-09-11; the db.t4g.micro → small decision reads it); anything
  trending that would surprise Jamie at the bill.

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
- **A long batch against a Lambda blocks everyone else's deploy, and the
  checkout lease will not tell them.** `elixir-mcp-migrate` and
  `elixir-mcp-jobs` both run at `ReservedConcurrentExecutions: 1`, so a
  backfill or repair looping invocations holds the whole function: a
  deploy's migration step answers
  `ReservedFunctionConcurrentInvocationLimitExceeded` (429) and the
  deploy fails after the code has already updated. Seen twice on
  2026-09-22, both self-inflicted. The lease guards the CHECKOUT, not the
  cluster - a batch can run with the lease released, and an actor who
  takes the lease meanwhile can code, verify and commit but will fail at
  deploy until the batch ends. Say in NOTES when a long batch is running
  and roughly when it ends; prefer a resumable op with a real remaining
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
number is what it is. DLQs are empty or their contents are understood
and fixed. The fleet's health matches what the Status page tells the
public. Cost is boring. A healthy no-op run ends with one line in the
notes and no commits.
