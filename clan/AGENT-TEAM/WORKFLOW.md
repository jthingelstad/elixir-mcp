# AGENT-TEAM operating model

> **Moved (2026-09-28), renamed and resumed (2026-09-29).** Elixir Clan's
> code lives in elixir-mcp's repository as `clan/`. Its four objectives
> run from that repository's Codex environment, each in its own worktree
> (the root `AGENT-TEAM/WORKFLOW.md`, "One worktree per run"), and share
> the repository's one lease (`AGENT-TEAM/scripts/objective-lease.mjs` at
> the root) under the keys `clan-run`, `clan-judge`, `clan-loop` and
> `clan-guard`.

Elixir Clan is maintained by four objective owners. An owner is accountable
for an outcome, not a job type or a directory, and follows evidence through
diagnosis, code, tests, deployment and natural acceptance instead of handing
each step to another role.

Read `AGENTS.md`, this file, `AGENT-TEAM/README.md`, `AGENT-TEAM/READING.md`
and the selected objective before acting. The entry point never replaces
the product docs it points at.

## Operating loop

1. Run the repository's `AGENT-TEAM/scripts/preflight.sh` (at the root)
   from this run's own worktree (the root `AGENT-TEAM/WORKFLOW.md`, "One
   worktree per run"). A dirty, diverged or unexpectedly-ahead worktree
   makes the run read-only; one that is only behind moves with
   `git checkout --detach origin/main`. Never publish a pre-existing commit.
2. Measure current state: the live site and API (`/api/clan/health`, the smoke
   script's reads), CI (`gh run list`), the
   stack and its alarms (`--profile cloud-engineer`, read-only), the ledger through
   the host scripts, `docs/NOTES.md` since the last reviewed revision, and
   Elixir's JSON API contract version against what
   `services/api/src/elixir-api.mjs` expects.
3. Decide whether a real objective gap exists. Healthy is a complete result.
4. Only when a safe, authorized gap requires a change, branch before the
   first edit: `git switch -c <key>/<slug>` (`clan-run/`, `clan-judge/`,
   `clan-loop/`, `clan-guard/`). Edits take no lease. A live write (a
   feedback answer) or a local deploy claims the repository's one lease
   first: `node AGENT-TEAM/scripts/objective-lease.mjs claim <key>` from
   the worktree root; keep the returned `leaseId` and release it once the
   write is verified. A held lease is a wait; never clear one merely
   because it looks old (`clear-stale` records the proof). A run that
   cannot finish queues a note for Jamie (`note <key> --reason "<text>"`,
   or `abort` when holding the lease).
5. Fix the gap at the source in the same run, with the regression test that
   would have caught it. A warning, a guard or a ticket chain is not a fix.
6. `npm run verify` before every commit. Commit only this run's work on
   its branch and land it as a pull request on a green `validate`
   (AGENTS.md, "Landing changes"): `git push -u origin HEAD`,
   `gh pr create --fill`, `gh pr merge --auto --rebase --delete-branch`,
   `gh pr checks --watch --fail-fast`. `main` refuses a direct push (GH013);
   never work around it. `clan-deploy` deploys `main` after its
   `validate`; the smoke script runs after every deploy. Work that cannot
   merge in the run stays an open PR, recorded in the report; the worktree
   is discarded when the run ends, so nothing may live only in it.
   `AWS_PROFILE=cloud-engineer node clan/infra/scripts/deploy.mjs` is for a
   deploy CI cannot make (a parameter change), from a fetched, detached
   `origin/main` under the lease, and is said so in the run's report.
7. Verify the deploy (`gh run list`, the smoke output, one live read of the
   changed surface). Verify semantic success from natural evidence: a
   verdict on the real roster, a real feedback item answered, a real grant.
   Never manufacture an action decision, a comment, a hold, a note, a grant or a feedback
   item for acceptance; never write to Elixir; reads only against live data.
8. Release the lease if this run claimed one, and end with nothing in the
   worktree that is not merged or in a pull request.

## Ownership and acceptance

- The originating objective verifies CI and the live surface for its own
  commit; Clan Operator owns failed-pipeline recovery and continuing
  health. A failure that spans runs becomes an `objective:run` issue.
- Clan Policy Auditor owns semantic acceptance of anything that judges: a changed
  rule is accepted against the golden tests AND one real evaluation read
  back from the ledger.
- Clan Feedback Manager owns the response to every feedback item and the truth of
  the docs; `done` means shipped, with the merged PR or its merge commit named.
- A clean deploy never substitutes for natural evidence.

## Issues are the exception ledger

Do not open an issue to authorize, claim, route, deploy or close same-run
work. Keep one only when work spans runs, an external dependency blocks it
(usually Elixir), Jamie must decide, or the arc needs a durable record.
One objective label each; no dispatch or handoff labels.

## Human boundary

Jamie decides: any change to what the engine judges or how (a new policy
field, a new award kind, a changed starting value), anything that touches a
member's in-game standing outside the leader's own decision on an action,
anything published outside a signed-in session (nothing is, by decision), the
OAuth scope, anything stored about a person beyond what `AGENTS.md` lists, and
broad communication to a clan. Ask one concrete yes/no
question with the evidence and the smallest useful version.

Autonomous when they preserve that boundary: bug and reliability fixes, a
misleading label or help text, a docs gap, test coverage, observability, the
kit change Clan needs (in `packages/`, in the same pull request), and answering feedback
whose answer is already decided.

Leaders decide their own clan's policy and awards through the product.
This team never edits a clan's policy, awards, actions, holds, notes or
grants on a clan's behalf.

## Automation memory

Automation memory holds only `Current state`, `Active watches` and one
replace-in-place `Latest run`. Remove resolved watches. Git, issues, CI,
AWS and the ledger hold history.

## Reporting

End as `HEALTHY`, `CHANGED`, `WATCHING`, `BLOCKED` or `NEEDS JAMIE`:

```text
Outcome: HEALTHY | CHANGED | WATCHING | BLOCKED | NEEDS JAMIE
Objective: <objective name>
Evidence: <most decision-relevant facts>
Action: <what changed, or None>
Next check: <natural event/date, or None>
Jamie: <one yes/no question, or None>
```

Report the measured outcome and the remaining risk, not workflow ceremony.

## Calendar and due work

`automations.toml` owns the calendar; `SCHEDULE.md` is its generated view
(`projects-sysadmin/scripts/render_automation_schedules.py --repo . --write`).
Weekly subtasks keep last successful evidence and the next due date in
current state; a retry checks that receipt before repeating work; a blocked
due subtask remains due at the next eligible invocation.
