# Architecture, efficiency, durability and features review — 2026-09-27

**Status:** analysis only. Nothing in product code changed. Written
against `c8ae040` (contract 9.12.0, JSON API 2.6.0, migration 0184),
the morning after the Dependabot deploy, with production healthy
(`health.ok` true, 0 dead jobs, 0 dead letters).

**Outcome (2026-09-27, later):** Jamie set database restore aside
("the one thing I'm not worried about is restoring the database … I'm
very comfortable with its resilience"). That removes the database half
of §2.1, all of §2.2 and all of §2.3; the line is in DECISIONS under
"Declined". Guard the Door fixed the relay logging item (§8.1) the same
morning (PR #56, `76f68c6`). The rest is sorted into four lanes by who
decides in [`2026-09-27-EXECUTION-BRIEF.md`](2026-09-27-EXECUTION-BRIEF.md):
lane A (fixes, no decision) is GitHub issues #62-#73 under the
`review-2026-09-27` label; features, policy and parked work are held
there for a revisit once lane A closes.

**Ask (Jamie):** "This is a complex data product and it is working well.
Please review for architectural improvements, efficiency and durability
improvement, and features that would materially improve the service."

**Method.** Ten reviewers, one per dimension: the recording path; the
scheduler and budget; the MCP request path; database growth;
infrastructure and recovery; auth and the JSON API; the console, site
and kit; ops and process; features from the consumer side; features
from the platform side. Each reviewer's findings went to an
independent verifier told to refute them. The verifier opened every
citation, grepped DECISIONS, NOTES, the weekly archives and the earlier
reviews for anything shipped, in flight or declined, and judged
materiality at this scale. A completeness critic then named three areas
nobody had covered, and each got its own reviewer and verifier: the jobs
lane and product mail at open-beta scale, the open-signup preconditions
privacy.md names, and the read side of attested facts. **93 findings
were raised and 91 survived.** 47 of those survived only in part, and
the corrections are folded in below. One conflicted with DECISIONS (a
per-tag withhold overlay, against "CR tags are not PII"). One restated
a standing position (no Athena serving path). The synthesizing session
re-checked the eight claims with the most at stake against the code.
Line references are as of `c8ae040`.

**Sources.** The code, plus reads between 05:07Z and 07:22Z of
`/api/public/status`, `/stats` and `/efficiency`. `elixir_data_insights`
and a handful of other read-only tool calls. The live site's assets and
headers. NOTES, `docs/notes/`, `docs/reviews/` and `AGENT-TEAM/`. No
write, no `live: true`, no AWS or CR API call.

**What this does not do.** It proposes nothing on the declined list and
reverses no ratified line. Where a finding costs money, or touches a
ratified line as a tradeoff, it goes to Jamie's calls (§9.3). Six door
and auth-plane findings are summarized here without mechanics (§6.5).
This repository is public, so their details went to Jamie directly.

---

## 0. What changes the picture

1. **The history has one failure domain.** The product is the record
   that the CR API forgets. Every copy of it (the database, its 7-day
   backups, the manual snapshots and the kept-forever archive) lives in
   one AWS account in one region. A mistaken or compromised operator
   session, which is the role every agent deploys with, can remove all
   of it, and nothing lost can be fetched again. The restore path has
   not been exercised since the 2026-09-06 encryption migration, and
   both obvious restore levers fail today (§2.1, §2.2). The five
   collectors belong to one operator and most likely sit on one
   network (§2.4).

2. **The mechanism behind the worst outage is still live.** Apart from
   the MCP door's per-call budget, no Lambda's database connection has
   a name or a statement bound. On 09-15 an orphaned migration backend
   held an exclusive lock until the door ran out of connections (about
   35 minutes down). On 09-18 two orphaned jobs backends ran 42 and 57
   minutes until someone killed them by hand. The Explore and `/api/v1`
   doors run the same tools with no server-side timeout. Five template
   lines and one migration close this at $0 (§3.1, §3.2).

3. **The one global budget is a convention in code, and its ceiling is
   closer than the status page suggests.** Only the planner charges
   `budget_state`. Live mints never do, and a backlog left by a fleet
   outage drains at fleet speed, not bucket speed. Consumption is about
   33% of bulk capacity; the status page's "15%" is a calendar-hour
   artefact. The model is about 20 fetches a day per recorded player,
   which puts the ceiling near 3,600 recorded players against 1,150
   today. Ranking-origin recordings alone are growing by about 21 a
   day. The Sunday pre-reset hour saturates first, at about 1,650-1,700
   recorded players (§4).

4. **Open beta has preconditions nobody owns.** privacy.md promises
   answers and a removal path that no code can honour yet. There is no
   account-erasure op, and no way to make contact without an account
   (§6.3). The server brief, meant to state the conventions "once here
   rather than in fifteen argument descriptions", is cut at 2,048
   characters in Claude Code, so the rules that shape answers never
   arrive (§6.1). One auth-plane finding is reachable by any approved
   account and should be fixed before access widens (§6.5). Once the
   weekly mail run
   passes 900 s, the newest accounts stop getting mail (§6.7).

5. **The system that builds Elixir loses owed work.** Open items live as
   phrases in NOTES, which rotate into the archive every Monday. One
   security item from Guard's 2026-09-20 run was lost that way and is
   still in the code. Twelve scheduled runs a day leave no receipt, so a
   healthy run and a run that never happened look the same (§8.1, §8.2).

None of these is urgent. Production is healthy, capture loss is
0.03-1.5% a day, and in the gated beta every account is effectively
first-party. They are what will break first as the service grows, or
what could not be undone if it did break.

## 1. What is working, and should be preserved

- **Archive before commit, freshness on admission.** The S3 put comes
  before COMMIT, so a committed row always has its payload twin and a
  failure leaves only a harmless orphan. A poll window moves only when
  a payload is admitted.
- **The high-water mark rides the lease.** Collectors drop 94-95% of
  battle-log entries before sending them (`edge_filtered_24h`), the hub
  filters again underneath, and the same row serves as the capture
  audit.
- **A Postgres ledger instead of queue infrastructure.** SKIP LOCKED
  leasing, bounded attempts, plan-and-enqueue in one transaction under a
  partial unique index, and reserved concurrency 1. Re-plans, async
  retries and overlapping ticks are safe by construction.
- **Measured, not asserted.** The session clock shipped with
  `capture_audit` and `capture_efficiency_daily`. Gaps fell from
  101-121 a day to 4-34, and lost battles from 513-646 a day to 8-408.
  The persisted meta population cut the nightly from 495 s to 63-86 s,
  with an equivalence op to prove the result.
- **One registry.** Each tool's declaration, handler, output schema,
  annotations and principal filter live together, and `tools.json` and
  the docs reference are generated from it. The invoker is the single
  choke point for audit, capture and the query budget. The budget
  cancels the query in Postgres rather than only abandoning the
  promise.
- **Credential hygiene.** Every secret is stored only as its sha256.
  PKCE is S256 only. Refresh rotation revokes the whole family on
  reuse. Audience separation is enforced in SQL. CSRF discipline holds
  across all 43 state-changing console routes.
- **Deploy and CI discipline** well beyond what a hobby account needs:
  SHA-pinned actions, `permissions: {}`, no persisted token and no AWS
  credentials in CI. The REQUIRED/PRESERVED/SECRET parameter discipline,
  Retain and DeletionProtection on the record, and a deploy that runs
  only a green `origin/main`.
- **Incidents become guards:** `unknown_op`, the migration sha256 pins,
  the migration-rule tests, the ops catalogue test, and acceptance bites
  that must fail on a real bad capture.

The recommendations below extend these patterns. None replaces one.

---

## 2. Durability of the record

### 2.1 An off-account copy of what cannot be fetched again — high, M

**As built.** RDS is single-AZ with `BackupRetentionPeriod: 7` and no
cross-region or cross-account snapshot copy (`infra/template.yaml:160-196`).
`ArchiveBucket` is versioned and Retained, with no replication and no
Object Lock (`template.yaml:1265-1318`). Its noncurrent-version expiry
has no prefix, so an overwritten payload stays recoverable for only 365
days. The deploy role can delete. The 2026-09-25 fixture removal was
done with operator credentials (correctly, on Jamie's word), which
proves the path exists. The archive also cannot rebuild the database on
its own. Accounts, claims, grants, collections, moments, attested
facts, receipts and the time of every repeat observation live only in
Postgres (§2.3).

**RPO as built.** A bad write noticed within 7 days: about 5 minutes
(PITR). A bad write noticed later, a region loss or an account loss:
everything.

| Option                                                                                                                                                                                                                                                   | Covers                                | Cost/mo | Notes                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** A vault account (free under Organizations) in a second region. S3 replication of `payloads/` only, with Object Lock default retention on the destination. A weekly RDS snapshot copy re-encrypted under a customer-managed KMS key, shared to the vault. | account loss, compromise, region loss | ~$5-8   | The instance uses the AWS-managed `aws/rds` key, and a snapshot under that key cannot be shared across accounts, hence the CMK re-encrypt. Leave `calls/` out, because its 90-day expiry is a privacy promise. Replication skips delete markers, so the five fixtures removed on 09-25 stay in the vault; the rebuild procedure should list and skip them. |
| **B.** The archive as in A. For the database, a nightly logical export from the jobs Lambda, through the S3 gateway endpoint, of only the tables no rebuild can restore (account and its kin, claims, attested facts, the moment ledger, receipts, the mail ledger). | the irreplaceable half                | ~$3-5   | New code, but the tables are small and there is no KMS work. Battles and snapshots then rest on the archive plus the parity proof in §2.3.                                                                                                                                                                           |
| **C.** RDS automated-backup replication to a second region in the same account.                                                                                                                                                                              | region loss only                      | ~$1-3   | Does not meet the threat that matters most: a mistake or compromise at the account level.                                                                                                                                                                                                                  |

**Recommendation.** First ask whether projects-sysadmin's Recover
Projects objective already keeps an off-account copy
(`AGENT-TEAM/run-elixir-mcp.md:189` hands the backup inventory to it).
If it does, this finding shrinks to writing that copy's location into
ENGINEERING. If it does not, choose option A. Day bundles (§7.7) matter
only if replication PUT costs do; bundling cuts about 12-16k objects a
day to about 15. In the same change, correct the wording of DECISIONS
121 and ENGINEERING.md:87-90: the archive rebuilds projections and game
observations, not accounts, claims, grants or receipt provenance.

### 2.2 A restore path that works when it is needed — high, M, $0

Both levers an operator would reach for fail today. Changing
`DbSnapshotIdentifier` means replacing an instance that has the fixed
name `elixir-mcp-enc`, which CloudFormation refuses; that is why 09-06
had to rename. And `deploy.mjs` runs migrations and the vocabulary
import against the live database before it touches the stack, so it
cannot run while the database is down (`deploy.mjs:157-192`). The
remaining lever, a hand-typed `update-stack`, silently resets every
omitted PRESERVED parameter. No rehearsal receipt exists since 09-06,
when the restore took about 21 minutes at 40,647 battles; the database
is now about twelve times that size. No backup or maintenance window is
set, so AWS picks random slots in us-east-1's 03:00-11:00Z block. That
block holds the nightly jobs and the 10:00Z peak, and
`AutoMinorVersionUpgrade` on a single-AZ instance means minutes of
downtime inside it.

- Set `PreferredBackupWindow` to about 06:00-06:30Z and
  `PreferredMaintenanceWindow` to about Sun 06:30-07:00Z: after the
  04:40-05:30Z jobs, and clear of 09:30-10:30Z. S, $0; ship this first.
- Write the restore runbook around a **rename swap** that avoids a
  CloudFormation replacement:
  1. Pause the scheduler and mail rules.
  2. Run `restore-db-instance-to-point-in-time` into a new identifier,
     with the same parameter group, subnet group, security group,
     monitoring role and log exports.
  3. Verify with the schema fingerprint and row counts.
  4. Rename the live instance to `-old` and the restored one to
     `elixir-mcp-enc`. The endpoint follows the name, so every
     `DATABASE_URL` keeps working and the stack keeps tracking the
     instance.
  5. Pre-warm the hot tables, because a restored volume loads lazily
     from S3.
  6. Re-enable the rules.
- Add `deploy.mjs --stack-only` (no build, no migrate, same
  `buildParameters`), so an infrastructure change during an incident
  still keeps the PRESERVED discipline.
- Rehearse once, timed, against a scratch restore before open beta
  (about $0.10). That also satisfies the quarterly receipt
  `run-elixir-mcp.md` already asks for.
- Jamie's call: `BackupRetentionPeriod` from 7 to 35 days (about
  $1/mo), which gives a month to notice a bad write to the canonical
  tables. Multi-AZ (about +$25/mo) stays a tradeoff, not a
  recommendation.

### 2.3 Prove the archive can rebuild what it claims to — medium, M

The only replay is `{series_backfill}`. By design it writes only the
series half, and it walks `api_receipt` rather than the archived
objects. Nothing replays battle logs, and nothing has checked that the
filtered, new-battles-only objects written since 2026-09-11 hold every
battle the database holds. That is consistent with the design, which
treats battles as the system of record that "must never need a
rebuild". But DECISIONS 121 names `payloads/` as the rebuild source,
and that claim has never been tested.

- A read-only `{replay_parity: {day}}` op. It canonicalizes one day's
  admitted battlelog objects in memory and diffs the `battle_id`s and
  the participant and card-row counts against the database. Keep the
  Record True runs it weekly and again at the restore rehearsal.
- Later, and cheap: a nightly `receipts/dt=` JSONL export, so the
  archive can describe itself (admission, observed/filtered counts,
  repeat observation times) without Postgres. Also keyset-cursor the
  payload sweep, and persist `missing` somewhere the status endpoint
  reads.

### 2.4 The collector fleet is one person — medium, M

All five active collectors are operated by one account. The 09-06
notes put the fleet of that day on one house WAN, and nothing since
records a change; the cabin DS416 was planned but never recorded as
enrolled. The hub stores no failure-domain identity. A home outage
longer than about 90 minutes rolls active players' battle logs past the
record for good. An outage during Sunday 23:10-00:10Z loses the week's
donation counters. The door treats `probation` exactly like `active`,
so probation is not yet a control. COLLECTOR-ZERO-TRUST's activation
gate (the unbuilt shadow lane, or a written trust decision) keeps
anyone else out.

- Now, with no code: put one collector in a second failure domain,
  either the cabin or a small VPS outside AWS with its own allowlisted
  CR key (about $4-6/mo). Invite one trusted operator on a different
  network, under the written trust decision the gate already allows.
- Optionally, an owner-set private `site` label on `gateway`, with
  `sites_active` shown in Admin and a count on public status.
- Before strangers join, build the shadow lane the design already
  specifies. It should compare stable fields rather than raw hashes,
  because a battle log legitimately changes between two reads a minute
  apart. Sample about 10% while a collector is on probation and about
  1% forever after. The cost is under 1% of the budget.

### 2.5 The inline ingest failure path — medium, S first

When a submit throws, the receipt and projection roll back and the door
answers 500 without completing the job (`collector-door.mjs:594-605`).
The lease expires, and the CR API is asked again up to five times
before `LedgerDeadJobs` fires. Two things soften this. The S3 put runs
before the projector, so a projector bug usually leaves the bytes behind
as an orphan. And the 09-11 retry budget absorbs a transient deadlock.
What remains:

- the door does not retry 40P01 or 23505 itself;
- the transient submit-500 rate has no alarm and no row;
- a deterministic bug costs five refetches per plan cycle;
- `pipeline.mjs:536-541` and `ingest/src/handler.mjs:10-12` still
  describe the SQS path that left at 0040.

The fixes, in order:

- Retry `processResult` once in the door on 40P01 or 23505 before
  answering 500.
- Add a `submit_ingest_error` metric filter and alarm, copied from
  `EmailComposeFailedFilter`. It backs an alarm, so it fits DECISIONS
  165.
- Fix the stale comments. A parking table plus a replay op is optional
  after that.
- Related (§5.6): the per-(player, day) rollup refresh deletes and
  re-inserts in Set insertion order across observers. It is the only
  multi-row write on the battle path without a fixed lock order, and a
  plausible source of the unexplained battlelog deadlocks on 09-18.
  Sort it into one statement.

### 2.6 A failed fetch costs a whole cadence — medium, M

`last_planned_at` is stamped when a job is planned, and a non-200
submit or a dead job leaves that stamp in place (`plan.mjs:439`,
`pipeline.mjs:581-602`). A battle log therefore waits one cadence
before a retry. A profile, which has no floor, waits a day. An anchored
daily board, or the events read, that errored at the 10:05Z tick waits
for tomorrow's board day. Errors are rare (about 13 non-404s a day),
but one CR maintenance break at 10:05Z would lose that board day for
every board in it.

The fix: on a non-404 error or a dead job, stamp `poll_state.retry_at`
at now + 15 minutes, doubling for up to three tries. The retry is
charged like any other plan, freshness still moves only on admission,
and the 404 hold is unchanged. This mirrors the ratified incomplete-board
re-read (0173).

### 2.7 Smaller hardening

- **Write-once archive (low, S, $0).** Send `IfNoneMatch: "*"` on every
  `payloads/` PutObject, and treat 412 as already archived, since a
  retried submit re-puts the identical key. Then, after a test on a
  scratch bucket, add a bucket-policy deny on `payloads/*` PutObject
  without `s3:if-none-match`. Drop `s3:PutObject` from `MigrateRole`,
  which nothing uses; that closes the NOTES 2351 item.
- **Roster ordering (low, S).** Unlike every other state projector, the
  membership diff never compares `fetchedAt` with the last admitted
  roster. The path to two overlapping fetches is narrow (a bulk clan job
  planned while a live one is leased), but the result would be a false
  `member_left` in the most-read place. Skip subjects with an open job
  in `selectEligible`, which also saves a duplicate fetch, and skip the
  diff when `fetchedAt <= last_admitted_at`.

---

## 3. Bounding the database's background work

### 3.1 Name and bound every backend — high, S, $0

All five VPC Lambdas connect as one database user with no
`application_name` (`template.yaml:707,741,780,860,893`). Apart from the
MCP invoker's per-call budget, none bounds its statements; the
parameter group sets only logging. The migration runner
(`migrate.mjs:72-86`), 10 of 15 op modules and every jobs connection
run unbounded. `{terminate_backends}` can only match on query text,
which `ops.md` warns "ends live door queries too". This is the
mechanism behind three incidents:

- 09-15: an orphaned 0099 backend held ACCESS EXCLUSIVE until the
  connection slots were gone;
- the first live nightly left an orphan;
- 09-18: two `create temp table pop` backends ran for 42 and 57
  minutes.

The fix:

- Per function, set `PGAPPNAME` (`elixir-mcp-migrate`, `-jobs`, `-mcp`,
  `-web-api`, `-scheduler`) and `PGOPTIONS` with:
  - a `statement_timeout` below the Lambda's own timeout: about 285 s
    for migrate, and for jobs a per-statement bound that fits its
    batches rather than 885 s;
  - `idle_in_transaction_session_timeout` of about 60 s, so an orphaned
    open transaction releases its locks.

  The migrate dispatcher sets `application_name='migrate:<op>'` per op.
- Put `lock_timeout` on the read-only tool path (the invoker's
  `set_config`, or the MCP door's URL). Do not set it blanket on
  web-api: ingest writes share that connection, and row-lock waits
  between submits are normal there.
- One migration in the 0155 shape:
  `alter database … set client_connection_check_interval = '10s'`. It
  is a best-effort layer that cancels a statement once its client
  socket has closed.
- Filter `{backends}` and `{terminate_backends}` by `application_name`.
- On a scratch database, check that the invoker's per-call `set_config`
  still overrides the default. A connection-wide `statement_timeout`
  also reaches writes, which DECISIONS says "never race a deadline". A
  ceiling set just under the Lambda kill is defensible, and the ledger
  line should say so.

### 3.2 A deadline on every door — high, S, $0

The invoker applies its budget only when the call site passes
`deadlineMs` or `queryBudgetMs`, and `mcp/handler.mjs` is the only call
site that passes both. Explore (`explore.mjs:56-61`) passes neither.
`/api/v1` (`integration-api.mjs:244-251`) passes only the 15 s budget,
which reaches only the nine `BUDGETED_TOOLS`. So `clans_participation`,
with a p95 of 10.2 s over MCP and read by Elixir Clan every morning,
runs unbounded on those doors. The comment at
`web-api/handler.mjs:372-374` says ending the client cancels the query,
but Postgres does not notice a closed socket mid-statement unless the
check interval above is set.

- Pass web-api's `deadlineMs(context)`, less a reply margin, into
  `makeInvoker` at both call sites, so the ratified race covers every
  read-only tool on all three doors. Consider adding
  `clans_participation` to `BUDGETED_TOOLS`.
- Give `packSets` a time check beside its node budget. It is a
  synchronous search that the invoker's timer cannot interrupt.
- Fix the comment.

### 3.3 The migrate ops as a declared registry — medium, S then M

The 57 migrate ops are dispatched through a 513-line `if (event?.x)`
chain, all as the schema owner. Whether an op reads, writes or is heavy
is recorded only in `ops.md` prose, and the catalogue test compares
names only. Only 4 of the 34 read ops run in a read-only transaction.
`account_enroll` defaults to a dry run and `account_track` does not.
The sharpest defect contradicts a ratified line. `terminate_backends:
true` maps to `{}` (`lambda.mjs:326`) with a default floor of 120 s,
whereas DECISIONS 137 says "past five minutes (named, never `true`)",
and `ops.md:131` documents that `true` works.

- S, now: `terminate_backends` refuses `true` and a missing `like`, with
  a floor of 300 s. Wrap `oauth_grants` revoke's UPDATE and INSERT in
  one transaction. Add tests for it and for `{collection}`.
- M, next: declare `OPS = { name: { mode, heavy, log, run } }`, and
  have the dispatcher open the session.
  - Read mode sets `default_transaction_read_only`; every mode sets
    `application_name` and `statement_timeout`.
  - Write mode requires `confirm: "<op>"`, or defaults to a dry run.
  - Logs are summary-only for `feedback_*` and `activity_preview`.
  - The catalogue test compares mode and heavy with `ops.md`.
  - The jobs Lambda's 16 payloads get the same registry and catalogue
    rows.
  - An `ops_run` row per invocation makes "each use goes into NOTES"
    checkable.

---

## 4. The budget as code, and its ceiling

Golden rule 3 calls the one budget a ToS position. Today the code
enforces it only at plan time.

### 4.1 Charge the bucket where work is minted — medium, S, $0

Only the planner decrements `budget_state`. It subtracts
`selected.length` whether or not the enqueue inserted anything
(`plan.mjs:646-650`); `ledger.mjs:22` returns `inserted`, and the
handler ignores it. Live mints (`mcp/live.mjs:79-84`,
`integration-api.mjs:430-434`, `deck-cards.mjs:96-102`) never touch the
bucket. So `live_reserve` is the planner abstaining, not a reservation.
Only per-account daily caps bound the live lane, and those caps add up
as accounts grow.

After a fleet outage, every due subject holds one queued job. Recovery
drains that queue at fleet speed (five collectors at 1.5 s pacing,
about 3.3 a second), roughly two to three times what the bucket allows
in the same minutes. At about 3,000 recorded players the recovery hour
passes 3,600 fetches.

- Charge only rows with `inserted = true`, in the handler.
- Plan against `min(tokens, capacity − queued_bulk)`, so the ledger
  never holds more than about one tick's allowance.
- Route `deck-cards`' raw insert through `enqueueJob`. Decrement
  `budget_state` atomically for each newly inserted live row
  (`… where tokens >= 1 returning tokens`). When no token is left,
  answer `pending` with `retry_after_s` set to the next tick. The
  reserve then becomes real.
- Add a plan test: after a simulated two-hour fleet outage,
  post-recovery planned plus queued work stays within the bucket. Fix
  the stale comment at `handler.mjs:23`.

### 4.2 Know where the ceiling is before open beta finds it — medium, S, $0

The service makes about 25.3-26.7k fetches a day against 77,760 bulk
slots (270 per tick), or about 33%. The rolling hour is about 28%. The
status page's `used_hour` against `expected_hour` compares a partial
calendar hour, which is how a read at 05:10Z shows "152 of 636".

Each recorded player costs about 20 fetches a day: 17.6 battle-log
polls (a parked log still costs about 12) plus the profile. A
comprehensive clan costs about 1,150. That puts the ceiling at about
3,600-3,700 recorded players, against 1,150 today. The fastest-growing
block is sticky ranking presence: 324 recordings on 09-14 and 608 on
09-26, about 21 more a day and 53% of recorded players. That also
contradicts Keep the Boards' alert line, which calls anything past about
400 a defect.

- Make the status lines honest. Admin capacity should be
  rate × 86,400 × (1 − live_reserve), not 86,400. Rename or replace
  `expected_hour`, and make `fetches_24h / bulk_capacity_24h` the
  headline.
- Have the jobs Lambda file one feedback item, in the shape-census
  pattern, when the trailing-24 h share passes about 70%, or when
  `due_starved` stays above zero for several ticks outside 10:00Z and
  Sunday 23:00Z. Until saturation, consumed load is committed load, so
  no per-subject model is needed yet.
- Show the marginal cost (about 20 a day per player, about 1,150 a day
  per comprehensive clan) where Jamie approves access.
- Jamie's call before open beta: the **saturation ladder**, meaning
  which work degrades first when the budget binds. Today the code has
  an accidental one (§4.3).

### 4.3 Rank by class, not by one mixed-unit key — medium, S

Eligible work is sorted by `yield_bph × hours overdue`
(`plan.mjs:570-587`). Only battle-log rows have a real `yield_bph`.
Profiles, boards and race rows default to 0.5, and clan rows use
membership events per hour. So a daily read scores about 10 or more the
moment it is due. A 4-bph follow-up at 30 minutes scores about 2, a
war-day race poll about 0.25, and a tracked roster about 0.025. A
capacity-bound tick therefore serves the lowest-information daily reads
first. Only the 10:05Z and Sunday 23:10Z ticks bind today, so the cost
is minutes; under saturation it would be hours.

Sort by an explicit endpoint class taken from the ladder, and keep
`bph × overdue` within the battle-log class. Pin the cross-endpoint
order with a plan test whose budget is smaller than the eligible set. A
defensible interim order:

1. starved, requested and forced;
2. war-day races and tracked rosters;
3. battle-log follow-ups;
4. other battle logs;
5. anchored dailies, which have the whole board day to land;
6. incidental rosters.

### 4.4 The Sunday pre-reset watcher is O(players) — medium, S

In the hour before Monday 00:10Z, the planner forces a profile read for
every recorded player not yet read in the window, and ranks those reads
starved-first (`plan.mjs:497-554`). The counter it protects is
donations. That counter is also on every clan roster, and the roster
projector already writes each member's `pre_reset` row with the same
`greatest()` rule (`series.mjs:270-278, 352-365`). On 09-20 the 23:00Z
hour planned 1,904 jobs, 817 of them forced profiles, and the bucket
bottomed out at its 30-token reserve. Demand passes that hour's
capacity at about 1,650-1,700 recorded players. At the 09-14..09-26
growth rate of ranking-origin recordings alone, that is about a month
away. Until about 3,000 players, though, the overflow only delays other
work by 20-25 minutes.

- Force the `clan` row for incidental clans whose roster was not
  admitted in the window.
- Force profiles only for clanless players, or players an in-window
  roster did not list. Tracked clans need nothing.
- Measure first with one read-only count: distinct `last_known_clan_tag`
  against N. Ranking-origin players are spread across many clans, so
  the saving is perhaps 40-60% of N, not N down to 18.
- A roster-served `pre_reset` row has no profile-only columns; say so
  on the players_timeline docs.
- The season-roll watcher stays on profiles, because it needs
  `leagueStatistics`.

### 4.5 Two measurement corrections

- **The "90 stale regional boards" is mostly an artefact (medium, S).**
  Keep the Boards has reported this gap every run since 09-14. An empty
  board is valid and admitted, but the projector writes or confirms a
  snapshot only when the board has entries or its hash matches the last
  one (`rankings.mjs:269-276`), and `ranking_health` measures freshness
  only from snapshots. Count a board fresh when
  `poll_state.last_admitted_at` is within 26 h, and split out
  `empty_locations` and `not_found_locations`. Confirm with one
  read-only op before changing the objective. Disabling boards that stay
  empty or 404 for a whole season (about 90 fetches a day) is a
  separate call.
- **The session clock's ceiling overshoots its promise (low, S).** A
  0.85-1.15 jitter on a 120-minute ceiling allows up to 138 minutes,
  plus up to 5 more from the tick, against "never passes two hours" in
  recording.md. For battle logs, clamp to
  `min(cadence × jitter, SESSION_CEILING_MINUTES)` (about +700 polls a
  day, under 1% of capacity), then watch `lost_battles` for a week.

---

## 5. Efficiency

### 5.1 The invoker's fixed cost — medium, M, $0

The DB-free tools (`elixir_docs`, `elixir_updates`, `elixir_changelog`)
measure about 90 ms at p50, and all of that is the invoker's tail.
After the tool runs, the invoker awaits the capture's gzip and S3 PUT,
then the audit insert, one after the other. That contradicts
`capture.mjs:8-11` ("capture never sits in front of an answer"). It
re-reads the quota twice (`quota.mjs:115-127`) although `spendQuota`
has just returned both numbers, and runs `pendingHints` as a separate
statement. There are also 4-5 round trips before the tool runs. Inside
it, a `set_config` precedes every query, and each named subject gets an
unconditional `poll_state` UPDATE (`stampRead`). For the most-called
battle tools (p50 150-180 ms), this fixed floor is about half the
answer time.

The fixes, each keeping every row and every capture:

- Overlap the capture with the audit insert. S3 needs no connection,
  and ENGINEERING allows this.
- Skip `describe()` unless the live lane was touched.
- Fold the hints into the audit insert, and the admit side into one
  CTE.
- Re-issue `set_config` only when the remaining budget has drifted by
  more than about 1 s.
- Throttle `stampRead` to once every 10 minutes or so.
- Record `capture_ms`, and use the DB-free p50 as the before/after
  gauge.

### 5.2 Autovacuum where the meta readers depend on it — medium, S

Migration 0103 set insert-driven vacuum on `battle` and
`battle_participant` only. The meta readers probe `deck`, `deck_card`
and `meta_season_pop` index-only. `deck.last_seen_at` is bumped on each
newer sighting, the deck rollups take non-HOT hourly updates on an
indexed column, and the six rollup tables are rebuilt nightly. At the
default 20% insert threshold, `deck_card` (about 2M rows) waits for
about 400k inserts between vacuums. The 09-26 cold read (15.4 s against
2.9 s) came mostly from a backfill's visibility map, which DECISIONS
134 already governs. But `deck_card` at 92% all-visible is the
steady-state case.

Write one migration in the 0103 shape, with `lock_timeout` first:
insert-scale 0.02, vacuum-scale 0.05 and analyze-scale 0.02 on `deck`,
`deck_card`, `meta_season_pop`, `battle_participant_card` and the six
rollup tables. Check `{tables}` a week later.

### 5.3 Measure what the next instance and storage decisions wait on — medium, S

- **`pg_stat_statements`.** It is free and preloaded on RDS; DECISIONS
  189 declines Performance Insights, not this. Add a read-only
  `{statements}` op returning the top 20 by `total_exec_time` and by
  `shared_blks_read`, with normalized text only.
- **A daily size and I/O row**, written by the nightly
  `series_metrics`: `pg_database_size`; total, heap, index and toast
  bytes for the ten largest relations; and the day's `blks_hit`,
  `blks_read` and `temp_bytes` deltas. It is a row, not a metric
  (DECISIONS 165), so Run Elixir MCP can compute the slope and runway in
  SQL.
- **Storage runway.** Storage grows about 0.45 GB a day. With 20 GiB
  allocated, the 2 GiB alarm and the first autoscale arrive together,
  around 10-13 to 10-18. `MaxAllocatedStorage: 100` is reached roughly
  April-July 2027 at today's volume, and sooner once open beta grows the
  record. At that point recording stops, with about 5 days' warning.
  Jamie's call: a ceiling chosen for a date (for example 200 GiB, on
  gp3 at about $0.115/GB-month; allocated storage never shrinks). After
  the first autoscale, the fixed 2 GiB alarm means "autoscaling can no
  longer help". Do not partition: every card-row read is a
  primary-key-prefix probe, and nothing is ever dropped.
- **A written trigger for db.t4g.medium** (about +$24/mo over the small,
  with the micro reservation applied), for example a week in which the
  participant or card-row index hit ratio stays under about 0.95. This
  is Jamie's call (DECISIONS 160, 168).

### 5.4 Edge and bundle

- **Cache `/api/public/*` at the edge (medium, S).** `/api/public/cards`,
  `/cards/*` and `/efficiency` send `max-age`, but they fall through to
  the CachingDisabled `/api/*` behaviour, and every repeat read is a
  Miss. Efficiency runs two `api_receipt × capture_audit` scans per
  hit, which is issue #23 again. One `/api/public/*` GET/HEAD behaviour
  on CachingOptimized, placed before `/api/v1/*` and `/api/*`, replaces
  the two specific ones. Add a smoke check that a second GET is a Hit.
- **The console ships about 60 KB gzip it does not need (medium, S).**
  A 49 KB gzip chunk holds the whole contracts barrel, changelog prose
  included, to supply four constants. `Markdown.tsx` calls
  `marked.use()` at the top level, which puts the parser in the entry
  chunk although only Feedback and Admin render Markdown. The fixes:
  - subpath exports, or a `contracts/web` entry (the decisive fix);
  - lazy-initialize `marked` in the kit, which also helps Clan;
  - serve the site's hashed stylesheet instead of a second Vite copy;
  - a gzip-ceiling ratchet in `build-site.mjs`.

### 5.5 The MCP Lambda's CPU — medium, S, measure first

At 512 MB the MCP Lambda gets about 0.29 vCPU. Cold calls measured
1,168 ms against 462 ms warm, and the deck tools are synchronous
search. First split `duration_ms − db_ms − live_wait_ms` by tool and
`cold_start` from `mcp_call_audit`. Then try 1,024-1,769 MB and compare
a week later; at 3-30 billed seconds an hour, the cost is cents a
month. Treat `minify` as a separate small cold-start tweak, and do not
attribute the cold gap to CPU until the capture and init split has been
measured.

### 5.6 Connections and hot rows

- **The vocabulary cache never hits (low, S).** The card-role
  vocabulary cache is keyed by the `db` object (`card-roles.mjs:60-71`),
  and every call and submit gets a fresh client. That costs 4 queries
  per deck-bearing call and per submit with new decks. Move this cache,
  the season rows and the card catalog to a module-level cache keyed by
  `roles_version`, with a short TTL.
- **Hot rows (low, S).** A battlelog submit writes the gateway row four
  times, `poll_state` three times and the receipt twice: about 35-40
  statements where about 25 would do. The rollup refresh is per pair
  and unordered (§2.5). Sort and batch the rollup refresh, fold the
  `poll_state` writes into one upsert, and move
  `last_success_at`/`fetch_points` out of the transaction.
- **Per-request connections (low, M, measure first).** Read `connect_ms`
  p50 and p95 from the web-api log line before acting. If connecting is
  a material share of latency, reuse one client per warm container:
  destroy it on deadline or error, and reset session state. Reserved
  concurrency bounds it, so it is neither a pool nor RDS Proxy.
  Throttle the session and `service_token.last_used_at` writes to one
  every few minutes.

### 5.7 Small, or measure before building

- `popSelect` still derives the level gap by self-join. Read
  `deck_avg_level − opp_deck_avg_level` (0156) instead, proven by
  `{meta_rollup_equivalence}` (low, S).
- The nightly activity job scans a year of participant rows per
  recorded player. Bound the snapshot CTE and drop the unused count
  (low, S).
- Card aggregates join all of `deck_card`. Measure with `{profile_tool}`
  before adding `card_keys` to `meta_season_pop`; the evidence so far
  says the visibility map is the bigger lever (low).
- A caller-independent result cache for the heaviest reads. Size it
  first from `mcp_call_audit`, excluding acceptance and Gym traffic. In
  the meantime, spend the effort on the `cards_card` partner block
  (p95 17.0 s against an 18 s budget), which is the measured slow walk
  (low).
- 58% of the published argument-schema bytes are repeats of shared
  descriptions. Trim only the ones that carry no load (`display_name`,
  `on_behalf_of`, `mode`, `timezone`). Keep `season`, `segment` and the
  one-size verbosity marker, which is regex-matched
  (`protocol.mjs:213`). Given §6.1, argument descriptions are the only
  place some clients see the conventions (low, S).

---

## 6. Open-beta readiness

### 6.1 The brief is cut at 2,048 characters — high, S, $0

The initialize brief (`protocol.mjs:71-165`) runs about 4,500
characters for a person: identity, about 3,000 characters of
conventions, START, feedback and the disclaimer. Claude Code hands the
model exactly the first 2,048, ending mid-sentence in the verbosity
convention. The reviewers, their verifiers and this session all
received it that way. So none of the following ever arrives: the
archetype-label rule, mode discipline, `fit_for`, "re-fetch
`tools/list` when `serverInfo.version` moves", the manual pointer,
START and the feedback instruction. The identity block
(`identity.mjs:139-171`) has no cap, so with 50 slots a heavy user's
identity alone can fill the budget. Nothing tests this, because the
acceptance door and the Gym skip initialize.

- Budget the brief to 2,048 characters and order it by value:
  1. identity, capped at primary, clan and counts ("you also track 12
     players and 2 clans: `elixir_my_players` lists them"; the full list
     already rides `_meta`);
  2. the one-line rules that change answers;
  3. START and feedback;
  4. the window-echo grammar and verbosity detail, moved behind one
     `elixir_docs` pointer.
- Add a unit test that renders person and agent briefs with a
  50-player, 10-clan identity and asserts the key sentences fall inside
  2,048 characters.
- For person connections, drop `on_behalf_of` and `display_name` from
  the published schemas (about 6 KB), and strip them silently before
  validation so a cached client is never refused.

### 6.2 Protocol compliance and real clients — medium

- **Errors violate every published outputSchema (medium, S).**
  `protocol.mjs:470-480` puts the error envelope `{error, meta}` in
  `structuredContent`, but all 57 schemas require `meta`, `notes` and
  `docs`. The 2025-06-18 spec requires structured results to conform,
  and the reference TypeScript client validates them whenever they are
  present. So a strict client can throw away exactly the refusals whose
  hints the house invests in.
  - Omit `structuredContent` when `isError` is true, as an MCP patch;
    the text block carries the same JSON. First confirm that elixir-bot
    and the Discord agents read errors from the text block.
  - Validate `MCP-Protocol-Version`, defaulting to 2025-03-26 when it is
    absent.
  - Defer MCP Tasks for `live: true`. Tasks are experimental, client
    support is thin, and the pending/`job_id` flow already works
    statelessly.
- **A measured client matrix (medium, M).** quickstart already has
  per-client sections.
  - Add measured columns: instructions cap, `tools/list` caching and
    outputSchema validation.
  - Run one Gym journey per release through a real client (`claude mcp
    add`). It would have caught §6.1.
  - Add the contract version and "reconnect" to the unknown-argument
    hint, as the unknown-tool hint already does.

  A tradeoff for Jamie: the "every client is first-party" premise in
  DECISIONS 54 is already thin, because players' own connectors cache
  `tools/list`, and open beta ends it. ChatGPT support is a separate
  product call.

### 6.3 The promises privacy.md makes before general signup — high, S to M

privacy.md commits to answering lawful basis, data-subject rights and
how children are handled "before [general signup], not after"
(`privacy.md:20-22`). It also promises to remove account, address and
claims on request "through the feedback form or email the maintainer"
(`:213-217`). Neither can be honoured today:

- no migrate op deletes an account, and 15 foreign keys to `account`
  have no ON DELETE action;
- `POST /api/feedback` answers 401 without an account, and no
  maintainer address is published;
- the source of the obligation (the terms review, §2 and §4) is not in
  the repo, though DESIGN-v2:148 carries §4;
- "open beta" (8.0.0) and "general signup" are never reconciled.

The removal promise is live **today**, not only at signup.

- Jamie, in one DECISIONS line: does open beta keep owner approval
  (DECISIONS 22)? If so, privacy.md should say that "general signup"
  means removing approval.
- **`{account_erase}`** (M), a dry run by default and on Jamie's
  authority (DECISIONS 137). The order matters:
  1. Read the account's `email_send` rows and expire their `mail/sent/`
     bodies. Those bodies are keyed by `send_id` alone and `email_send`
     cascades, so deleting the account first would orphan them.
  2. Re-point `recording.requested_by` to the owner with an explicit
     UPDATE.
  3. Settle `collection.owner_account` (NOT NULL) as Jamie decides.
  4. Delete or null the other non-cascading rows.
  5. Delete the account.
  6. Queue the Buttondown removal.

  A test should enumerate every FK to `account`, so a new table cannot
  escape the op. privacy.md should say plainly that erasure removes the
  account's link to game data, and does not stop a tag being recorded
  while another reason to record it holds (consistent with DECISIONS 41
  and 91).
- Publish a contact route that works without an account.
- The children line on privacy.md is Jamie's: the age floor, whether it
  is attested, and what a report triggers. The deny path plus
  `{account_erase}` is the mechanism. Add `age_attested_at` and
  `policy_version` only if the policy calls for attestation, and only
  when an approval-free signup path is built.
- Retention windows, which Jamie picks:
  - never-approved access requests keep a plaintext address, note and
    tag forever; null the address fields after N days and keep
    `email_hash`;
  - sent-mail bodies under `mail/sent/` have no lifecycle rule; add a
    `mail-sent-expire` rule;
  - add rows for both in limits.md and privacy.md.
- The export half (a zip of the verified players' record and the
  account's own records, with coverage intervals in the manifest)
  belongs at the signup gate. The cheap part now is a cursor passthrough
  on `GET /api/v1/players/{tag}/battles`, which today serves only the
  last 50 battles (a JSON API minor).

### 6.4 Captures — medium, S

- **Kept about 455 days, not 90.** On the versioned archive bucket,
  `calls-expire` writes a delete marker at 90 days, and the bucket-wide
  `expire-superseded-versions` rule then keeps the body for another 365
  (`template.yaml:1300-1314`). privacy.md:66, limits.md:94 and the ops
  skill all say 90 days. Add `NoncurrentVersionExpiration: 1` scoped to
  `calls/`, plus a separate `calls/` rule with
  `ExpiredObjectDeleteMarker`. After the deploy, verify with
  `ListObjectVersions` on a prefix older than 91 days.
- **The public repo is downstream of captures.**
  `acceptance/bites/fetch.mjs:10-13` assumes "nothing private rides a
  tool body" and copies responses verbatim. Since 9.2.0,
  `elixir_timeline` can carry clan-only and leaders-only attested
  facts, and the Gym principal can read its clan's. None of the 41
  committed timeline bites holds an attested item yet, but the premise
  is already false: one committed bite carries `section: "account"`
  items.
  - In `fetch.mjs`, strip or stub `attested` and `account` items,
    keeping kind, section, time and subject, and fix the header
    comment.
  - Have `bites.test.mjs` fail on any committed bite that holds one.
  - Leave the private S3 capture and the owner's call record whole.

### 6.5 Door and auth-plane hardening — one high, two medium, three low

Six verified findings cover the OAuth door, consent, IP-keyed limits,
credential refusals and attested-fact writes. This repository is public
and several of them are unpatched, so their mechanics are not written
here. They went to Jamie directly. Each belongs in a fix PR, and its
description can carry the detail once the fix ships. The high one is reachable
by any approved account; fix it before any widening of access.

One detail is not sensitive and can be stated here. The `observed_ip`
that the collector config tells operators to allowlist is the
CloudFront edge address, not the operator's own
(`collector-door.mjs:399-402`, `operators.md:140`). A test pins the
wrong value.

### 6.6 The recording door shares a lane with everything else — medium

Collector config, lease and submit (with ingest inline) share the site
API's quick-create `$default` route and its throttle (20 rps with a
burst of 40, against a measured peak of 15). They also share the
web-api Lambda's reserved concurrency of 20 with the console, sign-in
and `/api/v1`. Collectors retry only transport errors and 5xx. So a
surge of 429s expires leases unsubmitted and raises `missed_streak`;
ten in a row quarantines a collector, and all five belong to one
operator.

- In the next collector release, treat 429 as retryable on submit: add
  it to the `submit_retry` envelope that config serves, with a backoff
  inside the 90 s lease. That is cheaper than a split, and it covers
  floods too.
- The `/api/public/*` edge caching in §5.4 removes the pressure from
  anonymous reads.
- When console or `/api/v1` growth warrants it, split out a
  `CollectorFunction`, built from the same bundle and mounting only the
  collector routes. Give it its own quick-create API and throttle, and
  an `/api/collector/*` behaviour ahead of `/api/*`. Collectors keep the
  same URL.

### 6.7 Mail at open-beta scale, and four correctness bugs today — medium

The jobs Lambda is one serial lane: 15 of the 16 EventBridge rules,
reserved concurrency 1, a 900 s timeout and no `EventInvokeConfig`. The
mail run composes each recipient's mail before it asks the ledger
whether that mail was already sent.

- **Weekly runs starve the newest accounts past 900 s (medium, S
  first).** Each async retry restarts from the oldest account
  (`ctx.mjs:21-31` orders by `created_at`) and dies at about the same
  place. The most recently approved accounts get nothing, every week,
  silently, and each re-run overwrites `email_issue.facts` for issues
  already sent. At about 25 accounts the run is far from 900 s; the
  crossover is extrapolated at about 300-600 accounts for
  `tracking_report`.
  - Now: one ledger query before the loop drops recipients (and clans)
    already sent for the period.
  - Then: log `{sent, remaining, ms}` and stop when about 90 s remain.
    Add `EventInvokeConfig` with `MaximumEventAgeInSeconds` of about
    3600.
  - Build an outbox continuation, and a per-run subject memo for
    `tracking_report`, only when a logged run passes about 450 s.
- **The milestone mail is held to one a day (medium, S).** That
  contradicts the exemption in DECISIONS 143, EMAIL.md ("holding it
  makes it late") and the public docs. The period key is the UTC date
  (`index.mjs:160`). A second moment later the same day is therefore
  skipped as already sent, and waits for the first pass after midnight.
  With a 26 h lookback, a roughly 2 h outage after midnight drops it
  for good. Key by the pass hour, or by the date plus a hash of the
  moment keys; `email_milestone` stays the once-ever guard. Add a test
  for two moments in one UTC day.
- **Written issues are not gated on their period (medium, S).**
  `latestWritten` takes the newest top_100 or card_of_week issue with
  facts, whatever its period (`index.mjs:231-238`). If this week's issue
  failed lint, every account approved since last week gets last week's
  issue as if it were new, and an issue accepted after 14:00Z is never
  sent.
  - Pass the expected period. When that period has no accepted issue,
    send nothing and notify the owner.
  - Keep `note` and `status` when a send upserts a written issue; today
    it erases "issue <key>".
  - Then: a late accept sends the issue. Treat refusal, `max_tokens`,
    the turn limit and bad JSON as final, instead of re-billing both
    model passes three times through SQS. Put a cache breakpoint on the
    brief's content block.
- **`clan_report` is composed as the first tracker (medium, S).** It
  uses the account-level `account_clan.scope` of `members[0]`
  (`build-clan.mjs:16-20`). If the earliest tracker chose activity
  scope, every recipient's report drops member battles and says "member
  battles are not recorded for this clan", even while a later tracker's
  comprehensive request is recording them.
  - Compose with the clan's recording scope, which is the widest any
    tracker asked for.
  - Format weekdays per recipient in the renderer, which also closes the
    queued timezone item.
  - Add a reader-invariance test: `buildClan` under two accounts gives
    deep-equal facts.
- **The written-issue lint does not bind numbers to entities (medium,
  M).** It flattens every number in the brief into one set
  (`top100-lint.mjs:47-54`). On the repo's own fixture, rotating the
  three podium ratings between the three named players and inventing
  "up 44 places" passes with zero findings. With a 100-row board, every
  integer from 10 to 100 counts as sourced.
  - Cheap step: check each `numbers_used` claim's digits against the
    value at its path.
  - Real fix: bind each number to the brief object that carries the
    sentence's name, and eventually use `{{v:path}}`/`{{name:path}}`
    placeholders that the renderer fills, as `{{deck:N}}` already does.
  - Do it once, after moving the Top 100 onto the shared
    `issue-pipeline.mjs` spine. The two copies have already diverged:
    `top100.mjs` has no force flag, and it omits `kind` in the editor
    hand-off.

### 6.8 Attested facts, read side — low

Attested facts are two days old, and they are the only viewer-dependent
data in a universal-reads system. Beyond §6.4 and §6.5:

- `build-tracking` should pass its `MOMENT_KINDS` filter into
  `buildTimeline`, which already applies a filter before the 150-item
  cap. The cap is then spent on moments, and attested items never enter
  the mail path.
  - Add a jobs test proving a leader recipient's tracking mail holds no
    attested items.
  - Add a registry-style test that lets only `entries.mjs` and
    `attested-facts.mjs` name `attested_fact`.
  - Defer a reader object and a `viewerDependent` flag until a second
    viewer-dependent read or a result cache is proposed.
- Retention for `member_away` and `clan_message`, periods for Jamie to
  pick (for example 30 days after `until`, and 180 days), with rows in
  limits.md and privacy.md. Write down what `{account_erase}` does with
  facts by an erased person and about them. If a withdrawal signal is
  wanted, exclude the app-computed `award_standing`, which Clan takes
  back daily.
- Store `departure_at` on `departure_classified`: the nearest closed
  membership's `left_observed_at`, or null when the record has none. An
  agent can then pair a classification with its `member_left` exactly.
  Also stamp whether the member was ever recorded, accepting the fact
  rather than refusing it (DECISIONS 84).
- Store when the attester's seat was observed, beside `attester_role`,
  and refuse a person's write when the clan's roster is hours stale.
- Optional: require an app's clan writes to target a clan that opted in
  (an `integration_clan_grant`, mirroring collection grants), or at
  least an open membership for the named player.

---

## 7. Features that would materially improve the service

All of these stay within the ratified lane: recording, facts rather
than judgments, no derived player metric, named populations.

### 7.1 The event as a first-class population — medium, M

DECISIONS says a tagged battle belongs to its event and must never be
pooled, and every `mode: "event"` read tells the agent to key on
`event_tag`. Yet no tool accepts `event_tag`. `group_by: game_mode`
keys on the (game_mode, type) slot, which Supercell reuses: trail +
TeamVsTeam carried ten distinct tags, and one live player has 369
battles in a single row with no event named.

- Ship `group_by: "event"` on `battles_performance` first: one row per
  `event_tag`, titled from `game_events`, with first and last played and
  W/L/D.
- Then add an `event_tag`/`tournament_tag` filter on `battles_query` and
  `battles_performance`. Extend it to decks, cards and opponents if the
  audit shows demand.
- Before building, pull `mcp_call_audit` for event-mode `battles_query`
  paging, to meet the "collapse a measured walk" bar.
- Rewrite `EVENT_POOL_NOTE` to name the argument.
- The meta population stays event-free.

### 7.2 Card history: following through on upgrade advice — medium, M

`battles_deck_upgrades` and `fit_for` tell a player what to upgrade.
Nothing can answer the next question: "what did I upgrade, when, and
did it help?" Level-ups are recorded in `player_event`, but they
surface only as a count on the timeline. A form unlock updates
`player_card` silently, because change detection reads only `level`
(`cards.mjs:121, 150-166`).

- Emit `card_form_unlocked`, going forward. It is a moment, so it
  reaches the timeline and the milestone mail.
- Serve `changes[]` on `players_collection`, under a window that
  defaults to the current season:
  `{card, form, from_level, to_level, observed_between}`.
- Add a choosing-a-tool row that pairs it with `battles_performance`
  `before_after`.

History starts 2026-09-14 for levels and at the deploy for forms. Any
fill from the archive is Jamie's call, and it would write rows, never
moments.

### 7.3 Gaps as a precise control — medium, M

When `ingestBattlelog` decides there is a gap, it holds both ends of
the unrecorded interval, yet `capture_audit` keeps only a boolean. The
existing `completeness_note` checks only the newest daily profile
interval, only for recent windows and at a 0.9 threshold. It never
locates the hole or cuts a streak. Gapped intervals ran 19.2% short
against a 3.7% baseline, and single intervals lost up to 348 battles for
heavy players. So "a 9-win streak" can span a hole the record knows
about.

- Add nullable `unrecorded_after` and `unrecorded_before` to
  `capture_audit`.
- Count the intervals that overlap the window in `battles_performance`,
  `battles_compare` and `battles_query`, and stop `current_streak` at
  the newest one.
- Fold this into the existing completeness note, so there is one note
  and not two.
- Show the intervals in `elixir_coverage`.

It is a minor, with the JSON API mirror check.

### 7.4 Stable timeline item ids — low, S

Timeline items have no identity. Consumers deduplicate by read pointer.
Sessions come back under the same `started_at` for the reader to "keep
the newest". The Discord preview "must never replay old activity". Give
each item an `id` and mirror it in `/api/me/timeline`:

- the ledger's `event_id` for ledger kinds;
- subject + kind + `started_at` for sessions;
- a hash of the existing dedupe key otherwise.

That is an additive minor, and it helps every consumer. Hold a
per-account Atom/JSON Feed of the timeline until a person or a vertical
asks for one; it would add a fourth credential class.

### 7.5 A record browser people can navigate — high/medium

- **Links are click handlers (high, M).** Explore's own header says
  "deep linking is the feature: every record has a real URL", yet 65
  anchors render `<a onClick>` with no href. The kit's `LogTable` cell
  API is `{text, onClick}`, which covers every record link in Activity
  and Admin, and in Elixir Clan through the pin. The Rail's `go()`
  calls `preventDefault` without checking modifier keys. The result: no
  keyboard focus, no new tab, no copying a link. axe does not flag an
  anchor without an href.
  - Add one kit `Link` that always renders an href and navigates only on
    an unmodified primary click, and change `LogCell` to `{text, href}`.
  - Render actions as `<button className="link">`.
  - Convert the 65 under a ratchet, then turn on oxlint `jsx-a11y`
    `anchor-is-valid`.
- **A failed write looks like nothing happened (medium, S).** 21 of 58
  awaited writes discard the envelope, including revoke key, suspend
  agent, sign out everywhere and approve access. `Make primary` clears
  its refusal whatever the server said.
  - Add a `useWrite` to `packages/client` that unwraps, invalidates only
    on success, and passes the error to one kit `WriteError`.
  - Convert the security-relevant sites first.
  - Add a ratchet on bare `await api.` writes.
- **Explore spends 2-3 metered calls per lookup, and cannot show the
  week it promises (medium, S).** Seed the record's query from the
  probe's answer. Fetch the war week with
  `war_history {clan_tag, season_id, section_index}`, and render
  standings, days and `member_weeks` as plain tables.
- **Honest 404s (low, S).** A mistyped `/docs`, `/cards` or `/updates`
  link returns S3's 403 XML. Any other unknown path is a soft 404: the
  shell redirects home in JavaScript (audit item F8).
  - Build a noindex `/404/` page and route misses under a static prefix
    to it.
  - Extract the edge function to `infra/edge/router.js`, so
    `serve-site.mjs` and the site tests run the real function.

### 7.6 Feeds and machine-readable surfaces done right — low, S

These fit the open-web grain of the product:

- **The What's-new RSS renumbers every GUID on each ship.** `feed.njk`
  lines 19-20 build GUIDs from `loop.index`, so about 24 old items come
  back as new, and the fragment anchors resolve nowhere.
  - Make each GUID the stable `/updates/<slug>` permalink
    (`isPermaLink="true"`).
  - Iterate `updatesView` so contract versions appear, or publish a
    second contract-changes feed. Integrators whose programs "never
    update" have no such feed today.
  - Cap it at about 50 items, and add `/feed.json` (JSON Feed 1.1).
  - Add a site test for unique, index-free GUIDs, and announce the
    one-time replay.
- **`llms-full.txt` is 847 KB, 45% of it update history** ("Pilot Score"
  appears 13 times). Limit it to the docs and the tool reference plus 14
  days of updates, with pointers to the rest, and add a size ceiling.

### 7.7 Builders and the archive — low, S

- **The builders' "publish your own stats" example points at the wrong
  door.** It tells builders to get a service key, but it reads
  `war_history` and `clans_standings`, which `/api/v1` does not serve.
  - Point its setup at an agent connection, which the example's own
    script already uses.
  - Correct "20 weeks" to "ten weeks" on the four surfaces
    (`examples.js:154, 294`, `data/index.njk:51`, `support.njk:123`) as
    a `/consistency` item.
  - Add war-history and standings operations only when Clan or an
    integrator asks. Widening `clans:read` is Jamie's call.
- **The Glue table's endpoint enum lists 6 of the 15 archived
  endpoints.** Extend it, and pin it to the ingest projector keys with a
  test. Day-major NDJSON bundles beside the raw objects can wait for the
  first corpus question, or for §2.1's replication if PUT cost matters.

### Considered and not recommended now

- **Webhooks or MCP resource subscriptions.** The door is stateless
  (`resources.subscribe: false`), the VPC has no NAT, and the timeline
  is synthesized at read time, so push would need a synthesis job per
  subscriber. Stable ids (§7.4) serve polling consumers.
- **Conditional requests on `/api/v1`.** Responses are computed per
  request and first-party clients are unmetered, so an ETag saves
  bytes, not database time.
- **Bulk or Parquet corpus access for integrations.** No integration has
  asked, and a bulk handout goes beyond "readable by every approved
  account".
- **Public per-subject data-quality pages.** Aggregate loss is already
  public, and per-subject pages would publish the recorded set outside
  the gated beta.
- **An Athena serving path.** Whole-season corpus reads are rollup reads
  (0.2-0.5 s), and the standing position (2026-09-11 review, §10.5)
  holds.
- **A per-tag withhold overlay** for recorded people without accounts.
  It conflicts with DECISIONS 41 ("There is no 'make my play private'
  option"). What privacy.md owes is the answer. If Jamie ever reopens
  41, the verifier's choke-point map is where to start: `registry.invoke`,
  `subject()`, `reconcileRecording` and two `plan.mjs` clauses.
- **Also not now:** MCP Tasks for `live: true`; a result cache before
  measurement; IAM database auth, given per-invocation connections on a
  small burstable instance; a CloudFormation `RollbackConfiguration`,
  which would not have caught the one incident cited and lengthens every
  deploy.

---

## 8. The engineering system

### 8.1 An open-items register — high, S, $0

Open items live as phrases in NOTES: "Needs Jamie", "Owed", "Not done".
There are 47 such markers in NOTES.md and 31 in W38, none with a
status. Monday's rotation moves them into `docs/notes/`, which objective
runs read only for background. Guard's 2026-09-20 finding, that all
four email-relay failure paths log untrusted `err.message`, survives
only in the W38 archive. At `c8ae040` it
was still in `email-relay/src/handler.mjs:52,90,112,129`; Guard the Door
fixed it later that morning (PR #56, `76f68c6`). The skills keep their open
items in git-ignored `reports/` folders on one machine. Answering the
README's "What across this team needs Jamie?" means reading about 8,000
lines.

The fix is a tracked register. It could be a `docs/OPEN.md` or
`open.json` shaped like `acceptance/known.json`, or GitHub Issues, which
the 09-07 security round used.

- Fields: id, raised (date and NOTES heading), owner, ask, `until`,
  status, closing commit.
- A test fails on an item past `until` with no new date and reason, and
  on a current-week "Needs Jamie" or "Owed" line with no id.
- Seed it with the relay logging item, then the battles timing pair
  (NOTES 2620 onward), then this review's §9.3.

### 8.2 Objective-run receipts — medium, S, $0

Twelve scheduled runs a day, all local on one Mac, leave no trace
whether they are healthy or blocked. The three instructions for a no-op
run disagree (`WORKFLOW.md:39-40`, `notes/README.md:4`,
`run-elixir-mcp.md:198-199`). A run blocked by a held lease cannot even
queue a note, because `abort` requires holding the lease. There has
been no Guard the Door note since 09-15, and no weekly summary for W38
or W39.

- Add `objective-lease.mjs receipt <objective> --verdict
  healthy|changed|blocked|failed --reason <text>`. It appends to a
  journal in `.git` and needs no lease. Claim, refuse, release and abort
  events go in the same journal.
- `preflight` and `status` show each objective's last receipt, and flag
  any objective overdue by twice its cadence.
- The Friday summary copies the tally into the repo.

### 8.3 Process hygiene — medium to low

- **Flakes (medium, S).** 6 of the 9 red runs among the last 200 were
  flakes, several of them wall-clock dependent. Test files read the
  wall clock 107 times across 30 files, and only one file pins it. CI
  runs only on push, so a time-of-day flake shows up whenever someone
  happens to push inside its window.
  - Add a scheduled, validate-shaped workflow at a few UTC times, one
    inside 06:40-12:00Z and one just after 10:00Z, held to
    `test-workflows.sh`.
  - Add a shared `pinClock` helper, with a ratchet on raw clock anchors
    in game-clock tests.
  - A template test database is optional hygiene: verify takes 81 s.
- **A batch marker for deploys (low, S).** Long migrate and jobs loops
  claim a marker beside the checkout lease, and `deploy.mjs` refuses to
  run while it is held. That turns the 429 at migration time into an
  up-front refusal. Per-actor worktrees stay a tradeoff against "Lease
  first" until the run journal shows real contention.
- **Decision citations (low, S).** Add a test that every DECISIONS
  citation's date plus qualifier resolves to a heading, and that the
  bold decision names quoted in `AGENT-TEAM/` and the skills match a
  line. Introduce ids only if that proves insufficient.

### 8.4 Console build and test

- **The e2e lane never serves a failure.** Every fixture answers 200,
  and the lane skips Explore records, the agent console and Admin. axe
  runs on five console pages and on no static page.
  - Add fixture helpers for a 503, a timeout and an HTML 502.
  - Add journeys for "could not be read" versus "no such X", for a
    failed write, and for the skipped pages.
  - Run axe on a sample of static pages.
- **CI builds the site three times:** the site test script,
  `validate.yml` and the Playwright webServer. Build it once.
- **Publish in order.** Today nothing carries Cache-Control, and a
  deploy briefly breaks lazy chunks.
  1. Sync `assets/` first, with `immutable` and no `--delete`.
  2. Sync documents with `max-age=0, must-revalidate` and `--delete`,
     excluding `assets/`.
  3. Invalidate.
  4. Prune unreferenced assets older than N days.

  The `.txt` charset rewrite must set Cache-Control too.
- **Router adoption (medium, L, incremental).**
  - Start with one kit `pendingComponent`/`errorComponent` that tells a
    failed read from not-found, which closes audit items M1 and M2.
  - Add `queryOptions` and loaders with `defaultPreload: 'intent'` on
    the record pages.
  - Move rail, doc and title data into route `staticData` afterwards,
    section by section.

### 8.5 Infrastructure hygiene

- **Secrets (medium, S now).**
  - Accept `SESSION_SECRET_PREVIOUS` and `ORIGIN_SECRET_PREVIOUS` for
    verification only, so either secret can rotate with no downtime.
  - Give unsubscribe tokens their own key, or a key id. Rotating
    `session_secret` today logs everyone out and breaks every
    unsubscribe link already sent.
  - Switch to `sslmode=verify-full` with the bundled RDS CA.
  - Write a rotation runbook, including the step where `db_password` is
    re-resolved into all five functions.

  Per-service database roles are L, and Jamie's call.
- **API Gateway settings in the template (low, S).**
  `AWS::ApiGatewayV2::ApiGatewayManagedOverrides` overrides a
  quick-create API's `$default` stage throttles and access logs without
  replacing the API; the 09-12 note assumed that was impossible. Declare
  the access-log groups with retention.
- **A decisive smoke (low, S).** Make one read-only authenticated
  `tools/call` as the acceptance principal, and check that
  `GET /api/collector/config` without a token answers 401 JSON. A
  `deploy.mjs --rollback` limited to the previous deploy record is a
  tradeoff against DECISIONS 176 and WORKFLOW's fix-forward rule.
- **`/api/v1` routing against its contract (low, S).**
  - Add a test that walks `integrationContract.paths` and asserts each
    (method, path, principal) routes to its declared operation and
    refuses an undeclared principal.
  - Fix the facts operations' `security` blocks, which omit
    `integrationKey`.
  - Map unexpected exceptions to 500 `internal` with no Retry-After.
    Today a deterministic bug answers 503 with `Retry-After: 5`.

### 8.6 Alarms for failures the door handles itself — medium, S

The invoker catches every tool exception and returns an `internal`
result, and a refused database connection becomes a handled 503. So
`elixir-mcp-mcp-errors` fires only when the door itself crashes; a
deploy that breaks a shared tool path pages nobody until acceptance,
the Gym or feedback notices. Also unalarmed:

- `EBSByteBalance%` and `FreeableMemory`, the documented failure modes
  (the micro's EBS balance hit 0 three times, and there were two memory
  recoveries on 09-11);
- web-api's 504s;
- the ACM certificate, whose renewal depends on a CNAME kept by hand at
  Namecheap.

Add a metric filter on `tool_failed_unexpectedly` and
`db_connect_failed` (it backs an alarm), plus alarms on EBSByteBalance%
below 25, FreeableMemory below about 150 MB, web-api Duration p95 and
ACM `DaysToExpiry` below 30: about $0.50/mo in all. Optionally, a Route
53 health check matching `"ok":true` at `/api/public/status` (about
$3-5/mo) would catch DNS, certificate and CloudFront failures from
outside.

---

## 9. Plan

### 9.1 Now: $0, small, no decision needed — PR-sized bundles, in order

- [ ] **Door hardening** (§6.5): the high finding first, then the other
      five. The details are with Jamie.
- [ ] **Bound the database** (§3.1-3.3): `PGAPPNAME`/`PGOPTIONS` per
      function; the `client_connection_check_interval` migration; the
      invoker deadline on Explore and `/api/v1`; a time check in
      `packSets`; `terminate_backends` refuses `true` and gets a 300 s
      floor; `oauth_grants` revoke in one transaction; ops filtered by
      `application_name`.
- [ ] **Budget in code** (§4.1, the status lines in §4.2, §4.5): charge
      only inserted rows; plan against the queued backlog; charge live
      mints atomically; honest capacity lines; `ranking_health` on
      admission; the jitter clamp.
- [ ] **Agent context** (§6.1, §6.2): the brief budget with its test;
      person schemas without agent arguments; `structuredContent`
      omitted on errors (after confirming elixir-bot and the Discord
      agents); `MCP-Protocol-Version` validation.
- [ ] **Privacy promises** (§6.4): `calls/` noncurrent expiry and
      delete-marker cleanup; bites strip `attested` and `account` items,
      with the test; the committed account items removed.
- [ ] **Mail correctness** (§6.7, §6.8): ledger-first recipients; the
      milestone key by hour; the written-issue period gate and note
      preservation; `clan_report` on the clan's recording scope, with the
      invariance test; the `build-tracking` filter before the cap.
- [ ] **Recovery basics** (§2.2): backup and maintenance windows;
      `deploy.mjs --stack-only`; the rename-swap runbook.
- [ ] **Database hygiene** (§5.2, §5.3): the autovacuum migration;
      `pg_stat_statements` and `{statements}`; the daily size and I/O
      row.
- [ ] **Edge and site** (§5.4, §7.6, §8.4): the `/api/public/*` cached
      behaviour; feed GUIDs and a cap; ordered publishing with
      Cache-Control; one site build in CI.
- [ ] **Engineering system** (§8.1-8.3): the open-items register, seeded
      with the relay `err.message` item first; run receipts; scheduled CI
      at clock-sensitive times.
- [ ] **Small correctness** (§2.5, §2.7, §7.7): a door retry on 40P01 and
      23505; the stale SQS comments; `IfNoneMatch` on archive puts, and
      `MigrateRole` without PutObject; the roster ordering guard; the
      Glue enum with its test; the "ten weeks" `/consistency` pass;
      `observed_ip` from the viewer header.

### 9.2 Before open beta

- [ ] An off-account copy (§2.1) and one timed restore rehearsal (§2.2).
- [ ] A second collector failure domain and a second trusted operator
      (§2.4). The shadow lane before any stranger's collector goes
      active.
- [ ] `{account_erase}`, a contact route that needs no account, the
      children line and the retention windows (§6.3).
- [ ] The saturation ladder decided, and the planner's class order taken
      from it (§4.2, §4.3). The pre-reset watcher on rosters (§4.4).
- [ ] 429 retryable on collector submit (§6.6). The recording door's own
      lane, if console or `/api/v1` growth warrants it.
- [ ] A measured client matrix, and one real-client Gym journey per
      release (§6.2).
- [ ] Console links and writes (§7.5); e2e failure fixtures (§8.4).
- [ ] Alarms for handled failures (§8.6), and the `submit_ingest_error`
      filter (§2.5).
- [ ] The mail time budget, `EventInvokeConfig` and ms logging (§6.7).

### 9.3 Jamie's calls

| #   | Question                                                                                                                                                                                                                                       | Recommendation                                                                                                  | Cost                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Is there an off-account copy today (Recover Projects)? If not, which option in §2.1?                                                                                                                                                           | A: a vault account in a second region, `payloads/` replication with Object Lock, a weekly CMK snapshot copy      | ~$5-8/mo                              |
| 2   | Backup retention from 7 to 35 days?                                                                                                                                                                                                              | Yes: a month to notice a bad write                                                                              | ~$1/mo                                |
| 3   | `MaxAllocatedStorage` set for a date, before the first autoscale (~10-13 to 10-18)?                                                                                                                                                           | Pick a number for a date (for example 200 GiB)                                                                 | grows ~$1/mo each month at today's rate |
| 4   | The saturation ladder: what degrades first when the budget binds?                                                                                                                                                                             | Decide before open beta; an interim order is in §4.3                                                            | $0                                    |
| 5   | Keep the Boards' "~400 is a defect" alert line, against the sticky rule's 608                                                                                                                                                                   | Reconcile the line with the rule                                                                                | $0                                    |
| 6   | Where are the five collectors? A second site, and a written trust decision for one outside operator?                                                                                                                                           | Yes to both                                                                                                     | $0-6/mo                               |
| 7   | Does open beta keep owner approval? And the privacy.md answers: recourse for recorded people without accounts (under DECISIONS 41), the children floor, retention windows for access requests, sent mail, aways and clan messages. | One DECISIONS line first, then the page                                                                         | $0                                    |
| 8   | Alarms for handled failures and instance health (§8.6); a Route 53 health check optional                                                                                                                                                         | Yes to the alarms                                                                                               | ~$0.50/mo (+$3-5)                     |
| 9   | A written trigger for db.t4g.medium                                                                                                                                                                                                            | For example, a week under ~0.95 index hit ratio on the participant or card-row indexes                          | +~$24/mo when triggered               |
| 10  | An MCP removal window once non-family clients exist (DECISIONS 54)                                                                                                                                                                             | A tradeoff to weigh before open beta, not a change now                                                          | $0                                    |
| 11  | A `deploy.mjs --rollback` to the previous deploy record (DECISIONS 176)                                                                                                                                                                         | Optional; make the smoke decisive first                                                                         | $0                                    |
| 12  | Per-service database roles                                                                                                                                                                                                                     | Later; dual-key rotation and verify-full come first                                                             | $0                                    |
| 13  | A VPS collector, if the cabin is not the second site                                                                                                                                                                                           | Only if #6 needs it                                                                                             | ~$4-6/mo                              |

### 9.4 When measured

Each of these waits on a measurement, and each section names the
number that would trigger it:

- the result cache (§5.7);
- `card_keys` on the population table (§5.7);
- per-container connection reuse (§5.6);
- MCP Lambda memory (§5.5);
- the mail compose fan-out and the per-run subject memo (§6.7);
- day-major archive bundles (§7.7);
- per-actor worktrees (§8.3);
- the Atom/JSON Feed of the timeline (§7.4).

---

## Appendix A. Findings index

Every verified finding, by section. "partly" means the verifier
confirmed the core and corrected details; the sections above give the
corrected version. The six rows in §6.5 are summarized without
mechanics.

| § | Id | Finding | Impact | Effort | Verified |
|---|---|---|---|---|---|
| 2.1 | `off-account-copy` | The record and every backup of it share one account and region, so one bad credential can erase history the CR API cannot give back | high | M | confirmed |
| 2.1 | `second-copy-of-irreplaceable-record` | The parts of the record nothing can rebuild have one copy: one account, one region, 7 days of backups | high | S | partly |
| 2.2 | `restore-path-blocked` | No restore runbook, no rehearsal since 2026-09-06, and both obvious restore levers fail today | high | M | confirmed |
| 2.3 | `archive-rebuild-unexercised` | 'Rebuildable from the S3 archive' has no replay behind it, and the archive cannot describe itself without Postgres | medium | M | partly |
| 2.4 | `fleet-single-failure-domain` | All five active collectors belong to one operator and probably one network, so an outage is irrecoverable history loss | medium | M | partly |
| 2.4 | `second-operator-shadow-verification` | The collector fleet is one person: add a trusted second operator now, and build sampled shadow verification before strangers join | medium | M | confirmed |
| 2.5 | `ingest-failure-discards-payload` | A failed inline ingest throws away the fetched payload, leaves no trace in Postgres, and counts against the collector | medium | M | partly |
| 2.6 | `failed-fetch-burns-the-window` | A failed fetch closes the job and leaves the subject 'planned', so a transient error costs a whole cadence: a board day, or a day of profile | medium | M | confirmed |
| 2.7 | `roster-diff-no-ordering-guard` | The membership state machine can diff an older roster against a newer state, and two fetches of one subject can be in flight at once | low | S | partly |
| 2.7 | `archive-write-once` | Make payloads/ write-once with S3 conditional writes, enforced by the bucket policy | low | S | confirmed |
| 3.1 | `orphaned-background-sql` | A timed-out job or op leaves its query running, and nothing bounds background SQL | high | S | confirmed |
| 3.1 | `bounded-named-backends` | Give every Lambda's database connection a name, and a statement timeout shorter than the Lambda's own | high | S | confirmed |
| 3.2 | `deadline-only-at-mcp-door` | Only the MCP door bounds its queries: the explorer and /api/v1 run the same tools with no server-side timeout, and no door connection has a lock or disconnect bound | high | S | partly |
| 3.3 | `ops-registry-enforced-modes` | Make the 57 migrate ops a declared registry whose read/write/heavy labels the dispatcher enforces | medium | M | confirmed |
| 4.1 | `budget-enforced-at-plan-not-fetch` | The global budget is charged when bulk work is planned, not when anything is fetched: live work and post-outage backlog escape it | medium | S | confirmed |
| 4.1 | `live-lane-outside-bucket` | Live fetches are never charged to the global token bucket, so the 1 req/s ceiling is a convention that breaks at 10x | medium | S | confirmed |
| 4.2 | `budget-ceiling-unmodelled` | The one budget covers roughly 3,600 recorded players, and nothing reports how much of it is already committed | medium | S | partly |
| 4.3 | `saturation-rank-key-mixes-units` | Under a starved budget the rank key puts daily profiles first and tracked-clan rosters and war-day race polls last | medium | S | confirmed |
| 4.4 | `pre-reset-watcher-is-per-player` | The Sunday pre-reset watcher forces one profile per recorded player into one hour, although the roster already records the donation counter | medium | S | partly |
| 4.5 | `stale-board-metric-counts-empty-boards` | The '90 stale regional boards' gap that has run for 13 days is largely a measurement artefact: empty boards are admitted but never confirmed | medium | S | confirmed |
| 4.5 | `jitter-overshoots-published-ceiling` | De-phasing jitter stretches the published 2-hour ceiling to up to 2h18m, plus up to 5 minutes of tick quantisation | low | S | confirmed |
| 5.1 | `invoker-fixed-overhead` | The bookkeeping around a call costs about as much as most calls: ~10 serial DB round trips and an S3 PUT sit in front of every response | medium | M | confirmed |
| 5.2 | `autovacuum-coverage` | Autovacuum is tuned on two tables; the tables the meta readers probe index-only depend on hand-run vacuums | medium | S | partly |
| 5.3 | `storage-runway-and-ceiling` | Storage runway: first autoscale around 10-18, the 100 GiB ceiling in roughly 7-10 months, and no per-table growth series | medium | S | partly |
| 5.3 | `cache-io-unattributed` | The cache and I/O question behind the next instance decision has nothing measuring it | medium | S | partly |
| 5.4 | `kit-barrels-defeat-treeshaking` | The contracts barrel and the kit's Markdown add about 60 KB gzip to every signed-in page load | medium | S | confirmed |
| 5.4 | `public-reads-uncached-at-edge` | /api/public/cards and /api/public/efficiency send Cache-Control that the edge never honours | medium | S | confirmed |
| 5.5 | `lambda-cpu-at-512mb` | The MCP Lambda runs at 512 MB, about 0.29 vCPU, while cold calls cost +700 ms and the deck tools are CPU-bound | medium | S | partly |
| 5.6 | `rollup-refresh-and-hot-row-churn` | Rollup refresh deletes and re-inserts each (player, day) in no fixed order and can race across observers; hot rows are rewritten 3-4 times per submit | low | S | confirmed |
| 5.6 | `no-connection-factory` | 81 call sites build a pg.Client from a bare URL; connection policy has no home, and connection-scoped caches die with each call | low | S | partly |
| 5.6 | `per-request-db-connections` | Every door request opens a fresh TLS Postgres connection and writes a 'last seen' row | low | M | confirmed |
| 5.7 | `result-cache-caller-independent` | The heaviest reads are recomputed per call although, for a resolved population and a closed or watermarked window, they are the same answer for every caller | low | M | partly |
| 5.7 | `tools-list-arg-duplication` | 59% of the published argument-schema bytes are the same shared descriptions repeated per tool, against the brief's stated intent | low | S | partly |
| 5.7 | `card-aggregates-scan-deck-card` | Every corpus card aggregate joins all of deck_card, a table that grows with every deck ever seen | low | M | partly |
| 5.7 | `nightly-rebuild-rewrites` | The nightly rewrites the whole running season's rollups, still derives the level gap by self-join, and records its timings only in logs | low | S | partly |
| 5.7 | `activity-year-scan` | The nightly activity job scans a year of raw participant rows per recorded player to keep three numbers | low | S | partly |
| 6.1 | `brief-cut-at-2048` | The initialize brief is cut at 2,048 characters in Claude Code, so the rules that shape answers and the START block never arrive | high | S | confirmed |
| 6.1 | `person-schemas-carry-agent-args` | People's tool declarations still advertise on_behalf_of and display_name, which a personal connection ignores | low | S | partly |
| 6.2 | `mcp-spec-currency` | Error results violate every published outputSchema, and the door stops at MCP 2025-06-18 while live: true is a hand-rolled task | medium | M | partly |
| 6.2 | `open-beta-client-readiness` | Open beta ends the 'every client is first-party' premise: no client matrix, ChatGPT untested, and cached tool lists are unguarded | medium | M | partly |
| 6.3 | `signup-preconditions-unowned` | privacy.md promises three answers before general signup; no code can honour them, nobody owns them, and nothing ties the signup switch to them | high | S | confirmed |
| 6.3 | `self-serve-record-export-and-erasure` | Let a person take their own record out, and leave: self-serve export plus an erasure op, before open beta | medium | M | partly |
| 6.3 | `erasure-and-withhold-share-one-primitive` | Account erasure and tag withholding are different deletions: build them as one module, or 'leaving' will not stop the recording and will orphan the sent mail | medium | M | partly |
| 6.3 | `children-minimal-rule` | 'How children are handled' needs one attested fact per account, checked at the two places accounts are made, and a disable-then-erase path; today no code knows the question exists | low | S | partly |
| 6.3 | `account-data-without-retention` | Two stores of personal data have no retention line and no pruning: never-approved access requests (third-party addresses included) and sent-mail bodies | low | S | confirmed |
| 6.4 | `captures-carry-attested-facts` | Captured timeline responses carry clan-only and leaders-only facts into the public repo and the agent team's context | medium | S | partly |
| 6.4 | `captures-kept-455-days` | Captured call bodies are kept about 455 days, not the 90 the privacy page promises | medium | S | confirmed |
| 6.5 | `door-1` | Door and auth-plane hardening item (details given to Jamie directly) | high | M | confirmed |
| 6.5 | `door-3` | Door and auth-plane hardening item (details given to Jamie directly) | medium | S | confirmed |
| 6.5 | `door-2` | Door and auth-plane hardening item (details given to Jamie directly) | medium | S | confirmed |
| 6.5 | `door-4` | Door and auth-plane hardening item (details given to Jamie directly) | low | S | confirmed |
| 6.5 | `door-6` | Door and auth-plane hardening item (details given to Jamie directly) | low | S | partly |
| 6.5 | `door-5` | Door and auth-plane hardening item (details given to Jamie directly) | low | S | confirmed |
| 6.6 | `recording-door-isolation` | The collector door shares one API throttle and one Lambda pool with the console, /api/v1 and anonymous traffic | medium | M | partly |
| 6.7 | `weekly-run-starves-newest-accounts` | A weekly per-account send that passes 900 s repeats its own first 900 s on every retry, so the newest accounts never get mail | medium | M | confirmed |
| 6.7 | `milestone-held-once-a-day` | The milestone mail is held to one per UTC day by its ledger key, contrary to the ratified exemption, and every hourly pass re-composes every account | medium | S | confirmed |
| 6.7 | `written-issue-send-not-gated-on-period` | Written issues: the 14:00Z send takes whatever issue is newest, the editor retries the failures it cannot fix, and never retries the one it could | medium | M | partly |
| 6.7 | `lint-does-not-bind-numbers-to-entities` | The written-issue lint checks numbers against one pool of every value in the brief, so a rating printed under the wrong player passes | medium | M | confirmed |
| 6.7 | `compose-subject-once-reader-neutral` | Build each subject's week once per run, independent of the reader: tracking_report rebuilds a shared clan once per tracker, and clan_report composes as the first tracker | medium | M | partly |
| 6.7 | `one-lane-for-maintenance-and-mail` | Mail and maintenance share one serial lane, and waits on it go unmeasured: a long send delays the :15, :20 and :45 jobs by up to 6 h | low | M | partly |
| 6.7 | `top100-duplicate-issue-spine` | The Top 100 still carries its own copy of the written-issue pipeline, and the two copies have already diverged | low | S | confirmed |
| 6.8 | `reader-has-no-type` | The viewer rule has no home: any accountId switches it on, and nothing marks the one viewer-dependent tool | low | S | partly |
| 6.8 | `app-key-writes-any-clan` | facts:write lets an app key write labelled facts into any recorded clan; nothing records that the clan turned sharing on | low | S | partly |
| 6.8 | `member-facts-unanchored` | Member facts are not tied to the record: a kick can be attested about a player the clan never had, and cannot be matched to the departure it classifies | low | S | partly |
| 6.8 | `fact-lifecycle-unwritten` | No retention for aways and clan messages, and a DELETE reaches only the row | low | M | partly |
| 6.8 | `seat-freshness-unchecked` | Seat checks never ask how old the roster is: a kicked or demoted leader keeps the leader view for 15 minutes to 48 hours | low | S | confirmed |
| 7.1 | `event-tag-has-no-argument` | The event is the population, but no tool accepts event_tag: 'how did I do in this event' means paging battles_query | medium | M | partly |
| 7.2 | `card-history-unserved` | Card upgrades are recorded but unreadable, and Evolution/Hero unlocks are not recorded at all, so the upgrade advice has no follow-through | medium | M | confirmed |
| 7.3 | `capture-gap-intervals-as-control` | The capture audit knows exactly which hours a log rolled past us, keeps only a boolean, and no read tool uses it | medium | M | partly |
| 7.4 | `timeline-atom-json-feed` | Your timeline in any feed reader: a per-account Atom and JSON Feed, with stable item ids | low | M | partly |
| 7.5 | `links-are-click-handlers` | Console links are click handlers: 65 cannot be reached by keyboard, and none opens in a new tab | high | M | confirmed |
| 7.5 | `writes-discard-envelope` | A third of console writes throw away the envelope, so failed revocations and approvals look like successes | medium | S | confirmed |
| 7.5 | `explore-double-calls-and-week` | Explore spends 2-3 metered calls per lookup, and its war-week record cannot show the standings it promises | medium | S | confirmed |
| 7.5 | `route-ownership-single-source` | Path ownership lives in five places, and a miss answers with S3 XML or a soft 404 | low | M | partly |
| 7.6 | `llms-full-is-mostly-history` | llms-full.txt is 847 KB, 45% of it update history, and it grows by about 11 entries a day | low | S | confirmed |
| 7.6 | `whats-new-feed-guid-churn` | The What's-new RSS feed renumbers its items on every ship | low | S | confirmed |
| 7.7 | `json-api-builder-gap` | The builders' 'Publish your own stats' journey promises war history over a service key, but the JSON API has no war or standings operation | low | S | partly |
| 7.7 | `archive-day-bundles` | Nothing can scan the archive: add day-major bundles beside the raw objects, and fix the Glue table | low | M | partly |
| 8.1 | `open-items-register` | Keep owed work and Jamie's open decisions in one tracked register with an expiry, not in NOTES prose that rotates into the archive | high | S | confirmed |
| 8.2 | `objective-run-receipts` | Record every objective run and every lease event, so a missed or blocked run can be seen | medium | S | confirmed |
| 8.3 | `clock-flakes-and-template-db` | Catch time-of-day flakes before they block a merge, and build test databases from one migrated template | medium | S | partly |
| 8.3 | `worktree-per-actor-deploy-lease` | Scope the lease to what actually conflicts: a worktree per actor, plus one deploy lease | low | M | partly |
| 8.3 | `decision-ids` | Give each DECISIONS line a stable id and a citation that points at one NOTES entry | low | S | partly |
| 8.4 | `router-as-catch-all` | TanStack Router is a catch-all: page knowledge lives in eight hand tables and five if-chains | medium | L | confirmed |
| 8.4 | `e2e-failure-states-and-builds` | The e2e lane never serves a failure, skips Explore, Admin and the agent console, and CI builds the site three times | medium | M | confirmed |
| 8.4 | `deploy-publish-ordering` | The site is published in one `s3 sync --delete` pass with no Cache-Control, so every deploy breaks lazy chunks for a few minutes | low | S | confirmed |
| 8.5 | `db-credential-and-rotation` | One static master password in five Lambda environments, one database user for every service, and no rotation path for any secret | medium | L | partly |
| 8.5 | `no-code-rollback` | A bad deploy can only be fixed forward through a PR, CI and a full deploy, though the design already makes code rollback safe | low | M | partly |
| 8.5 | `out-of-template-settings` | API Gateway throttles and access logs live outside the template and nothing checks them for drift | low | S | partly |
| 8.5 | `v1-contract-driven-dispatch` | /api/v1 authorization is hand-routed twice beside a contract that already declares it, and unknown failures become retryable 503s | low | M | partly |
| 8.6 | `mcp-failures-unalarmed` | The MCP door handles its own failures, so its error alarm never sees a broken tool; known instance failure modes have no alarm either | medium | S | confirmed |
| 7, not now | `athena-not-for-serving` | Keep corpus analytics on the Postgres rollups; the Glue table cannot answer a corpus question | low | S | already standing |
| 7, not now | `withhold-overlay-for-non-account-holders` | A per-tag withhold overlay: the smallest way for a recorded non-account holder to stop being recorded and have their detail withheld, with every reader and writer named | low | M | conflicts D41 |

## Appendix B. Measured facts (2026-09-27, 05:07-07:22Z)

- **Contract:** 9.12.0, with 57 tools. `tools.json` is 817 KB:
  argument definitions 94 KB (58% of that repeated), outputSchemas 182
  KB. JSON API 2.6.0 has 18 operations.
- **Corpus:** about 494k battles since 2026-01-03, growing about 22-25k
  a day. 384k player tags observed; 1,150 recorded players (919 direct,
  231 through clans); 18 recorded clans (8 comprehensive); 327k daily
  snapshots.
- **Budget:** 1 req/s, or 270 bulk jobs per 5-minute tick (3,240 an
  hour, 77,760 a day). Actual use is 25.3-26.7k fetches a day (about 33%
  of bulk capacity) and about 28% in the rolling hour. The peak is the
  10:00Z hour, at about 1,334. There were 20,239 battle-log polls on
  09-25, 28.8% of them productive: 17.6 per recorded player.
- **Capture:** about 19,000 polls and 26-27 gaps per 24 h. Lost battles
  ranged from 8 to 408 a day over 09-20..26 (0.03-1.5%).
- **Collectors:** 5 active plus 1 draining, all one operator's, all
  v3.0.4 and signed. Each makes 158-251 fetches an hour, with
  `edge_filtered_24h` at 0.94-0.95.
- **Database:** db.t4g.small, single-AZ, 7-day backups, 20 GiB gp3
  autoscaling to 100, growing about 0.45 GB a day. Autovacuum
  parameters are set on 2 tables, and no extensions are installed. The
  meta nightly takes 63-86 s against 900 s.
- **MCP:** 512 MB (about 0.29 vCPU). Cold calls 1,168 ms against 462 ms
  warm (measured 09-19). `cards_card` p50 9.3 s and p95 17.0 s against
  an 18 s budget. DB-free tools about 90 ms at p50.
- **Console:** /account/overview downloads about 224 KB of gzipped JS,
  including a 49 KB gzip contracts chunk. 65 anchors have no href, and
  21 of 58 writes discard the envelope.
- **Site:** `llms-full.txt` is 847 KB (45% update history), `/updates`
  548 KB, and `feed.xml` holds 258 items.
- **Process:** 57 migrate ops (23 of them writes). NOTES.md has 3,060
  lines this week and W38 had 5,025. About 1,205 test cases; CI verify
  takes 81 s. 6 of the 9 red runs among the last 200 were flakes. 12
  objective runs are scheduled a day.

---

_This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy._
