# AGENT-TEAM — objective owners for Elixir Clan

> **Moved (2026-09-28), renamed and resumed (2026-09-29).** Elixir Clan's
> code lives in elixir-mcp's repository as `clan/`. Its four objectives
> run from that repository's Codex environment, each in its own worktree
> (the root `AGENT-TEAM/WORKFLOW.md`, "One worktree per run"), and share
> the repository's one lease (`AGENT-TEAM/scripts/objective-lease.mjs` at
> the root) under the keys `clan-run`, `clan-judge`, `clan-loop` and
> `clan-guard`.

Four objective owners maintain Elixir Clan. Each owns a durable outcome, not
a task type, and follows evidence through diagnosis, implementation,
verification, deployment and acceptance itself. There is no dispatcher and
no Build Manager; building and testing are capabilities of every owner.

Elixir Clan is small and its stakes are personal: it judges real clan
members from Elixir's record and puts actions in front of real people. Two
things therefore matter more here than on a bigger product: the judgment
must stay faithful to the rules a clan chose, and a member who says "this
is wrong about me" must be answered.

## The team

| Objective | Key | File | Primary question |
|---|---|---|---|
| **Clan Operator** | `clan-run` | `clan-operator.md` | Is the product up, deployed from `main`, cheap, and still speaking Elixir's current contract? |
| **Clan Policy Auditor** | `clan-judge` | `clan-policy-auditor.md` | Do the verdicts, actions, standing and awards follow the clan's policy and the record — and does the record cover what they claim? |
| **Clan Feedback Manager** | `clan-loop` | `clan-feedback-manager.md` | Is every piece of feedback answered, acted on or framed for Jamie, and do the docs still describe the shipped product? |
| **Clan Security Reviewer** | `clan-guard` | `clan-security-reviewer.md` | Are the seams to Elixir, the public repo and the session cookies holding to their boundaries, with nothing published? |

Calendar cadence: [generated schedule](SCHEDULE.md), sourced from
`automations.toml`.

Renamed 2026-09-29, for names that say what each does: Run Elixir Clan,
Judge Fairly, Close the Loop and Guard the Door. Notes and summaries
written before then use the old names.

The Clan Security Reviewer is an independent control: the Operator
cannot waive its findings, and it never widens a scope, a cookie or a
public route to make another objective's work easier. Do not add a
Growth, Analyst or Cost role: cost belongs to the Operator, judgment
quality to the Policy Auditor, product signal to the Feedback Manager.

## How Jamie engages the team

Start with the outcome instead of choosing a role or preparing a ticket:

- `Run <objective> now and own the highest-impact measured gap.`
- `Investigate <symptom>; choose the owner by the failed outcome, not the file.`
- `Show me team status only; make no changes.`
- `What across this team needs Jamie?`

Choose **Clan Operator** for deploys, alarms, cost or the OAuth client; **Clan Policy Auditor** for a verdict, action, standing line
or award grant that looks wrong, or a season that closed without grants;
**Clan Feedback Manager** when feedback sits unanswered or the docs lie; **Clan
Security Reviewer** for scopes, cookies, secrets, the public repo, or the public
documents. Cross-cutting work keeps one originating owner through
acceptance.

## Boundaries with the neighbors

- **Elixir (the rest of this repository)** records facts and has no opinions. A fact this
  product needs and Elixir lacks is a request to Elixir's team (its
  `elixir_feedback` tool or its AGENT-TEAM), never a judgment moved
  upstream. Never touch Elixir's database; every seam is a public door.
- **Elixir Clan is for any clan** (Jamie, 2026-09-25). It was bootstrapped
  from one clan's Discord bot; that history is in `docs/NOTES.md` and is
  not a reference for how the product should behave. Each clan's own saved
  policy is. No team work saves a clan's policy, awards or pitch.
- **Nothing is published.** Every route under `/api/clans` needs a session;
  no other site reads a document from this product.
- **projects-sysadmin AGENT-TEAM** drains the shared alarm queue daily.
  This team owns *this stack's* operational truth: the Operator sees that
  `elixir-clan-api-errors` fired, Clan Operator owns why and the fix.
- **Interactive Claude sessions** (Jamie-directed feature work) use the
  main checkout, which scheduled runs never edit; a second concurrent
  session makes its own worktree. A local deploy or a live write claims
  the repository's one lease first (`AGENT-TEAM/scripts/objective-lease.mjs`
  at the root). The daily feedback duty belongs to the Clan Feedback
  Manager; interactive sessions do not drain it.

## Project map

- `AGENTS.md` (= `CLAUDE.md`): the five rules, the gate, sessions, the
  engine's contract, policy, awards, feedback, roles, quota, AWS. `docs/NOTES.md`
  is the decision ledger, newest last.
- `../packages/clan-engine/` — the pure engine (policy, facts, standing, evaluate,
  render, awards) and its golden tests.
- `services/api/` — one Lambda: auth, the gate, sessions, the roster,
  Manage (ledger, service, awards, recruit, scout), feedback.
- `apps/web/` — the SPA. `infra/` — one stack, deploy/smoke scripts.
- `scripts/feedback.mjs` — the feedback queue from the host;
  `scripts/actions.mjs` — actions and their logs, read-only, for review.
