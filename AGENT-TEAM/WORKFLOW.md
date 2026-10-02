# AGENT-TEAM operating model

Elixir is maintained by four objective owners (Elixir Operator, Elixir
Data Auditor, Elixir Feedback Manager, Elixir Security Reviewer). An objective owner is
accountable for an outcome, not a type of task or a directory of code.
It follows evidence through diagnosis, implementation, verification, and
production acceptance rather than handing steps to another role.

Read order for every run:

1. `AGENTS.md` (the repo golden rules), `docs/ENGINEERING.md` and the
   ratified-decision ledger `docs/DECISIONS.md`
2. this file and `AGENT-TEAM/READING.md`
3. `AGENT-TEAM/README.md`
4. the objective file and the current source documents selected by READING

READING is a document map, not a second product specification.

## One worktree per run

Since 2026-09-29 every scheduled run works in a git worktree of its own.
Codex creates it under `~/.codex/worktrees/` and runs
`.codex/environments/environment.toml`, whose setup
(`AGENT-TEAM/scripts/worktree-setup.sh`) fetches and detaches it at
`origin/main`, links this machine's gitignored files (the `.env` files,
the skills' reports) from the main checkout, clones the card-art cache,
links the sibling repositories beside it, and runs `npm ci`. Runs used to
share the main checkout and serialize every edit through one lease; they
collided often, and a held lease stalled the runs behind it.

- **Edits never collide.** A run's edits, commits and branch are its own;
  nothing it does touches the main checkout or another run.
- **The worktree is discarded.** Codex removes old worktrees. Before the
  run ends, everything worth keeping is merged or in an open PR;
  uncommitted work is lost.
- **The lease guards production, not the checkout.** A deploy, a migration
  run, or a write through an ops lambda (`{feedback_respond}`, a ledger
  requeue, a backfill) claims it; edits, tests, branches and PRs never do.
  It lives in the clone's common git directory, so the main checkout and
  every worktree see one lease and one queue of notes.
- **The main checkout is Jamie's and the interactive sessions'.** Scheduled
  runs never edit it. An interactive session works there when it is the
  only session; another makes its own worktree
  (`git worktree add --detach <dir>/elixir-mcp origin/main`, then the
  setup script from it with `CODEX_SOURCE_TREE_PATH` and
  `CODEX_WORKTREE_PATH` set).
- **Runs can still meet at the merge.** Two PRs editing the same lines
  conflict, and `validate` on a branch rebased onto main catches what a
  text merge misses (a repeated migration id). The later PR rebases
  (`gh pr update-branch --rebase`) and resolves.

Lease keys: `run`, `record`, `loop`, `guard` (this team);
`clan-run`, `clan-judge`, `clan-loop`, `clan-guard` (Elixir Clan's,
`clan/AGENT-TEAM/`); `clock`, `game` (the domain team's,
`../AGENT-TEAM/`); `session` (an interactive session).

## The operating loop

1. **Preflight.** Run `AGENT-TEAM/scripts/preflight.sh` from the
   worktree root. Its `OBSERVATION` verdict describes the public status
   probe; `MUTATION` describes whether this worktree may be edited (clean
   and at `origin/main`, detached or on a fresh branch); `DEPLOY_LEASE`
   names the lease's holder. Exit 1 prohibits edits, not safe
   observation; exit 2 means the preflight itself could not run. A dirty,
   ahead or unsynchronized worktree stays read-only; one that is only
   behind is clean to move: `git checkout --detach origin/main`, then
   preflight again. Never stash, publish pre-existing work, or execute
   another worker's uncommitted helper. Continue independent
   read-only triage with trusted installed tools or a verified committed
   helper and the already-authorized identity. A failed status probe is
   an operational finding, not proof all other read sources are unavailable.
   Check queued notes read-only; transcribing or clearing them is an edit (step 6).
2. **Measure before changing.** Establish the live state from the
   objective's authoritative evidence: the public status endpoint, the
   migrate/jobs lambda read ops, Postgres (`mcp_call_audit`, the job
   ledger, the feedback table), an alarm that fired, or a read-only
   probe. There is no CloudWatch dashboard and no metric without an
   alarm; Logs Insights reads the EMF line when a log is the evidence. Reproduce an observed
   problem before touching code.
3. **Decide whether there is an objective gap.** A healthy no-op is a
   successful run; write a one-line note and stop. Do not manufacture
   work.
4. **Fix at the source, in the same run,** when the gap is clear, safe,
   and within standing authority (see each objective's Action section).
   Guards and prompt patches are last resorts; the emitter or schema is
   almost always the right seam: normalize the shape at the source,
   never with a predicate in each reader.
5. **Check readiness, then branch.**
   For a runtime fix, verify the documented identity, required read access,
   deployment prerequisites and rollback path before editing. A successful
   identity check alone does not prove deployment permissions. Do not request
   broader access or perform a test mutation to establish readiness. Docs and
   offline tooling changes do not require AWS credentials. Before the first
   edit, `git switch -c <key>/<slug>`; edits take no lease.

   Claim the lease immediately before a production change (a deploy, a
   migration run, an ops-lambda write), never for an edit:

   ```bash
   node AGENT-TEAM/scripts/objective-lease.mjs claim <run|record|loop|guard|session>
   ```

   `session` is for an interactive session; the Gym claims `loop`.
   Keep the returned `leaseId`; `check` it before the production change;
   `release --lease-id <id>` once the change is verified. A held lease
   means another actor is changing production: wait for it (a deploy
   ships all of `origin/main`, yours included once merged), never break
   it. Never infer staleness from age alone; use the documented
   `clear-stale` path (it refuses while the holder's worktree has
   uncommitted work).
6. **Blocked on credentials? Preserve the work in a PR and leave a note.**
   Missing or expired access stops only the dependent operation. Continue
   independent safe reads, and never widen credentials. Queue the exact
   blocked capability for Jamie: `objective-lease.mjs note <key> --reason
   "<reason>"`, or, holding the lease, `abort <key> --lease-id <id>
   --reason "<reason>"`, which also releases it.

   If this run has edits, complete offline gates and commit only its verified,
   coherent work on the run's branch (`<key>/<slug>`), and preserve it as a
   PR: `git push -u origin HEAD`, `gh pr create --fill`. Turn on auto-merge
   (`gh pr merge --auto --rebase --delete-branch`) only when the verified
   source is safe on `main` without that deployment; the next deploy from
   `main` carries it, so never merge blocked infrastructure. Otherwise leave
   the PR open. Record the commit, the PR, tests, deployment still owed,
   dependent-change boundary, acceptance predicate and next owner check in
   `AGENT-TEAM/notes/`, in the same PR; a merged PR is not a shipped
   runtime fix. The worktree is discarded when the run ends, so nothing may
   live only in it: work that cannot be made coherent and verified goes up
   as a draft PR (`gh pr create --draft --fill`) with exact recovery steps
   in the report. Never discard edits to finish clean.

   A run with edit eligibility transcribes queued notes into
   `docs/NOTES.md` (the working notes) under a dated heading, in its PR,
   and clears the queue (`notes --clear`) once that PR has merged, so an
   escalation reaches the ledger even though the run that raised it could
   not commit.

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
   declaration instead. When a tool changes whose result a JSON API
   operation mirrors (`clans_participation`, `clans_roster`, the
   `live_fetch` clan read, `players_names`, `players_profile`,
   `battles_query`, `elixir_track_player`), check the matching `/api/v1` operation in
   `packages/contracts/integration-api.openapi.json`: the JSON API keeps
   ordinary semver, so a removed or renamed field there is its own major
   and a Jamie decision. Commit small and message-first on a branch
   (`<objective>/<slug>`), open a PR and let it merge on a green
   `validate` check (the `ship` skill's Merge step), then `git fetch
   origin && git checkout --detach origin/main`, and when runtime code
   changed, claim the lease and deploy:
   `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs`, adding
   `--acceptance=<family>` whenever a tool in that family changed
   (acceptance is opt-in per deploy and `deploy.mjs` prints a WARNING
   when it is skipped; the whole suite, `--acceptance`, is for shared
   code or a release). Migrations run
   BEFORE the code flip (expand-and-contract makes that safe) and a
   failed migration stops the deploy; the smoke checks after the flip
   REPORT failure loudly but do not roll back — a red smoke means fix
   forward now, not walk away. Verify the deployed behavior with a
   read, then release the lease.
9. **Record the run.** Append what happened to `docs/NOTES.md` when it
   changes durable state or a decision (a ratified decision also gets its
   one line in `docs/DECISIONS.md`), and to `AGENT-TEAM/notes/` for
   run-level detail worth keeping (findings, watches, proposals), named
   `<date>-<objective>.md` (`AGENT-TEAM/notes/README.md`).
   Weekly, the Friday Elixir Feedback Manager pass writes
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
architecture here more than once (`docs/NOTES.md` and `docs/notes/` have the scars).

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
