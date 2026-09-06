# AGENT-TEAM operating model

Elixir MCP is maintained by four objective owners. An objective owner is
accountable for an outcome, not a type of task or a directory of code.
It follows evidence through diagnosis, implementation, verification, and
production acceptance rather than handing steps to another role.

Read order for every run:

1. `CLAUDE.md` (the repo golden rules)
2. this file
3. `AGENT-TEAM/README.md`
4. the objective file named by the automation

## The operating loop

1. **Preflight.** Run `AGENT-TEAM/scripts/preflight.sh` from the repo
   root. It verifies the checkout is on `main`, clean, and synchronized,
   and prints a live health snapshot. A non-zero exit means stop and
   report — never pull, rebase, stash, or act on unexpected local state.
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
5. **Claim the checkout lease before the first mutation:**

   ```bash
   node AGENT-TEAM/scripts/objective-lease.mjs claim <run|record|loop|guard>
   ```

   Keep the returned `leaseId`; `check` it before the first edit and
   before push; `release --lease-id <id>` once the worktree is clean.
   Read-only runs need no lease. A held lease means another actor —
   an objective run or an interactive session — owns the checkout:
   stop before mutation. Never infer staleness from age alone; use the
   documented `clear-stale` path (it refuses dirty worktrees).
6. **Test first, then the gate.** New behavior lands with a test that
   fails without it. `npm run verify` (prettier + oxlint + knip + every
   workspace test against per-run scratch databases) must pass before
   any push. Against live data: reads and refusal paths only — never
   verify with writes.
7. **Ship it whole.** Docs ship with the change: site docs
   (`apps/web/src/docs/`) and `apps/web/src/updates.js` in the same
   commit for user-visible changes; a contracts version bump appends a
   changelog entry. Commit small and message-first, push `main`, and
   when runtime code changed, deploy:
   `AWS_PROFILE=jamie node infra/scripts/deploy.mjs` (smoke-gated —
   a failed smoke aborts the flip). Verify the deployed behavior with a
   read.
8. **Record the run.** Append what happened to `docs/NOTES.md` when it
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
