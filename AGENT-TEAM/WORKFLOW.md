# AGENT-TEAM operating model

Elixir MCP is maintained by four objective owners. An objective owner is
accountable for an outcome, not a type of task or a directory of code.
It follows evidence through diagnosis, implementation, verification, and
production acceptance rather than handing steps to another role.

Read order for every run:

1. `AGENTS.md` (the repo golden rules) and `docs/ENGINEERING.md`
2. this file and `AGENT-TEAM/READING.md`
3. `AGENT-TEAM/README.md`
4. the objective file and the current source documents selected by READING

READING is a document map, not a second product specification.

## The operating loop

1. **Preflight.** Run `AGENT-TEAM/scripts/preflight.sh` from the repo
   root. Its `OBSERVATION` verdict describes the public status probe;
   `MUTATION` describes checkout eligibility. Exit 1 prohibits mutation,
   not safe observation; exit 2 means the preflight itself could not run.
   A dirty, ahead, behind, detached, unsynchronized or leased checkout
   stays read-only. Never pull, rebase, stash, publish pre-existing work,
   or execute another worker's uncommitted helper. Continue independent
   read-only triage with trusted installed tools or a verified committed
   helper and the already-authorized identity. A failed status probe is
   an operational finding, not proof all other read sources are unavailable.
   Check queued notes read-only; transcribing or clearing them is a mutation.
2. **Measure before changing.** Establish the live state from the
   objective's authoritative evidence: the public status endpoint, the
   migrate/jobs lambda read ops, CloudWatch metrics, `mcp_call_audit`,
   the feedback table, or a read-only probe. Reproduce an observed
   problem before touching code.
3. **Decide whether there is an objective gap.** A healthy no-op is a
   successful run; write a one-line note and stop. Do not manufacture
   work.
4. **Fix at the source, in the same run,** when the gap is clear, safe,
   and within standing authority (see each objective's Action section).
   Guards and prompt patches are last resorts; the emitter or schema is
   almost always the right seam (see `docs/NOTES.md`: "normalize the
   shape at the source").
5. **Check readiness, then claim the checkout lease before the first mutation.**
   For a runtime fix, verify the documented identity, required read access,
   deployment prerequisites and rollback path before editing. A successful
   identity check alone does not prove deployment permissions. Do not request
   broader access or perform a test mutation to establish readiness. Docs and
   offline tooling changes do not require AWS credentials.

   Claim only when the intended work is eligible:

   ```bash
   node AGENT-TEAM/scripts/objective-lease.mjs claim <run|record|loop|guard>
   ```

   Keep the returned `leaseId`; `check` it before the first edit and
   before push; `release --lease-id <id>` once the worktree is clean.
   Read-only runs need no lease. A held lease means another actor —
   an objective run or an interactive session — owns the checkout:
   stop before mutation. Never infer staleness from age alone; use the
   documented `clear-stale` path (it refuses dirty worktrees).
6. **Blocked on credentials? Preserve the work and hand back a clean checkout.**
   Missing or expired access stops only the dependent operation. Continue
   independent safe reads, and never widen credentials. If no edits were made,
   use `objective-lease.mjs abort <objective> --lease-id <id> --reason "<reason>"`
   to release a clean checkout and queue the exact blocked capability.

   If this run has edits, complete offline gates and commit only its verified,
   coherent work when safe. Record the commit, tests, deployment still owed,
   dependent-change boundary, acceptance predicate and next owner check in
   `AGENT-TEAM/notes/`; a source commit is not a shipped runtime fix. Do not
   deploy past blocked infrastructure. Push only when the verified source is
   safe to publish without that deployment, then abort from the clean tree.
   If the change cannot be made coherent, verified and clean, retain the lease
   and report exact recovery steps; never stash, discard, or abandon edits to
   make abort succeed. The dirty-worktree refusal remains enforced.

   A run with mutation eligibility and its own lease transcribes queued notes
   into `docs/NOTES.md` under a dated heading and only then clears the queue
   (`notes --clear`), so an escalation reaches the ledger even though
   the run that raised it could not commit.

7. **Test first, then the gate.** New behavior lands with a test that
   fails without it. `npm run verify` (prettier + oxlint + knip + every
   workspace test against per-run scratch databases) must pass before
   any push. Against live data: reads and refusal paths only — never
   verify with writes.
8. **Ship it whole.** Docs ship with the change: site docs
   (`apps/site/src/docs/`) and `apps/site/src/_data/updates.js` in the
   same commit for user-visible changes; a contracts version bump
   appends a changelog entry. The tool reference (`/docs/tools`) is
   GENERATED from the MCP registry - never hand-edit it; fix the tool's
   declaration instead. Commit small and message-first, push `main`, and
   when runtime code changed, deploy:
   `AWS_PROFILE=jamie node infra/scripts/deploy.mjs`. Migrations run
   BEFORE the code flip (expand-and-contract makes that safe) and a
   failed migration stops the deploy; the smoke checks after the flip
   REPORT failure loudly but do not roll back — a red smoke means fix
   forward now, not walk away. Verify the deployed behavior with a
   read.
9. **Record the run.** Append what happened to `docs/NOTES.md` when it
   changes durable state or a decision, and to `AGENT-TEAM/notes/` for
   run-level detail worth keeping (findings, watches, proposals).
   Weekly, the Friday Close the Loop pass writes
   `AGENT-TEAM/summaries/<year>-W<week>.md`.

## Authority

- Objective owners fix defects, close measured gaps, respond to
  feedback, tune cadences within ratified policy, and keep docs true —
  without asking.
- New member-visible direction, entitlement or privacy boundary
  changes, spending changes, retention policy, and anything touching
  Supercell ToS posture go to Jamie as ONE concrete decision, not a
  menu.
- Escalations and proposals land in `docs/NOTES.md` under a dated
  heading plus a line in the run's notes file; urgent operational
  problems additionally follow the alarm path (the sysadmin Operator
  drains `projects-ops-alerts` daily).

## Evidence style

Numbers with receipts: every claim in a note names its source (the
endpoint, the query, the metric, the commit). If the evidence and a
comment disagree, trust the live reader — comments describe past
architecture here more than once (`docs/NOTES.md` has the scars).

## Definition checks and recurring work

Calendar schedules live in `automations.toml`; `SCHEDULE.md` is generated from it.
Read interval/date guards in the installed prompt before starting an objective.
Event phrases are explicit starts, not hidden automatic triggers. Recurring
subtasks record last successful evidence and next due date in the normal run
note/current state. A retry checks the receipt before repeating side effects.
A missed due pass stays due; record why it is blocked and retry at the next
eligible invocation, rather than silently waiting another week or quarter.

For an operating-instruction correction, record the exact failure, its cause,
the smallest contract edit, a case in `AGENT-TEAM/evals/decision-cases.json`,
and the next comparable natural evidence. Follow the evaluation README. A
passing fixture/contract test does not establish model decision quality;
without comparable natural evidence report `insufficient_sample`.
