---
name: consistency
description: Check that Elixir's decisions reach every surface that depends on them, then close the gaps. `/consistency <decision or topic>` traces one decision (cheap; run it the day a DECISIONS line lands or changes). `/consistency sweep` audits every ledger line, every facet and the connected repos, and finds dead docs and artifacts. Both verify findings against code, put product calls to Jamie one at a time, fix and guard the rest, deploy with acceptance and close out the ledger. Use when asked for a consistency check, an alignment audit, "is this decision realized everywhere", or cleanup of stale docs and artifacts.
---

# Consistency

A decision made in one place and not realized in the next is how Elixir
drifts. On 2026-09-25 the war tools went weekly-only while the timeline,
the ingest carry-back and a docs page still split war by day; the audit
that followed found about sixty such gaps. Jamie asked for it this way:
"review all the various facets of Elixir and make sure that they are
aligned with what they're connected with", and "identify docs or artifacts
that are no longer relevant".

**The unit of work is a DECISIONS line and every surface it touches.** You
orchestrate; read-only subagents trace. You are the only writer, under the
lease.

The files beside this one:

- `facets.md`: the alignment map. Which surfaces must agree with which,
  with paths. Read it before assigning anything.
- `classes.md`: the drift classes, each with the guard that stops it
  recurring. Every finding gets one class.
- `reports/`: one report per run (ignored by git, like the Gym's). A run
  reads the previous report of its mode first, so an open item is carried,
  not rediscovered. `reports/2026-09-25-sweep.md` is the first sweep.

## Two modes

**Trace: `/consistency <decision or topic>`.** One DECISIONS line (or a
topic that names a few: "war-weekly", "boat defense", "account:email").
Run it the day the line lands or changes, before the change is called
done. One or two subagents, an hour, not a day. The war-days gap would
have been caught this way the morning it shipped.

**Sweep: `/consistency sweep`.** Every DECISIONS line, every facet in
`facets.md`, the connected repos, and the artifact cleanup. Before a
public milestone, after a burst of decisions, or about monthly. On
2026-09-25 it took nine reviewers.

## Preflight

1. Claim the checkout lease before any write: interactively
   `node AGENT-TEAM/scripts/objective-lease.mjs claim session`; from an
   objective run, that objective's lease. The trace and verify phases are
   reads and may start before the lease frees; the fix phase may not.
2. Read `docs/DECISIONS.md` in full, `facets.md`, `classes.md`, and the
   previous report of this mode in `reports/`.
3. Note HEAD, the contract version (`packages/contracts/src/version.ts`)
   and the JSON API version (`info.version` in
   `packages/contracts/integration-api.openapi.json`). The report states
   what it reviewed.

## Phase 1: trace (read-only subagents)

Split the work by facet (sweep) or by surface (trace). Spawn the
subagents in ONE message so they run together; `general-purpose` for
anything that must judge, `Explore` for a pure where-is-it sweep. Each
gets this header:

```
You are one reviewer in an Elixir consistency <trace|sweep>. READ ONLY:
never edit, commit, deploy, call a write tool, or read .env files.
Repo root: /Users/otto/Projects/clash-royale/elixir-mcp (siblings under ..).
Read docs/DECISIONS.md, then .claude/skills/consistency/facets.md and
classes.md.

Your slice: <the decision lines, or the facet rows, this reviewer owns>
Question: for each decision in your slice, which surfaces in facets.md
depend on it, and does each realize it? Also: what in your slice is no
longer relevant (a doc, script, op, test, fixture, comment) and why?

Report each finding as:
  class (from classes.md) | the claim in one sentence |
  file:line where it is wrong | file:line or DECISIONS line that is right |
  who acts (defect: fix | Jamie: product call | sibling repo: which)
Also list what you checked and found CONSISTENT: coverage is part of the
report. Do not propose fixes beyond one line each.
```

For a sweep, slices that worked on 2026-09-25: (1) tools and their
schemas, (2) second derivations (timeline, mail, console), (3) the JSON
API, (4) accounts, identity and privacy, (5) recording, ingest and
schema, (6) the ledger, runbooks and skills, (7) public docs, (8) the
connected repos, (9) artifacts and cleanup.

## Phase 2: verify

Reviewers are evidence, not authority. Re-read the code for every
finding before it reaches Jamie or a commit, and mark what you
re-verified. Drop what does not hold and say so in the report's
coverage section. Live reads through Jamie's `mcp__elixir-mcp__*`
connection are allowed for evidence; never verify with a write against
live data.

## Phase 3: sort

Every verified finding is one of:

- **Defect.** The code, a doc or an artifact contradicts a DECISIONS line
  or itself. Fix it without asking.
- **Product call.** The ledger is silent, contradicts itself, or the fix
  would change what a number means, remove something someone relies on,
  or touch a declined idea. A review bullet is not a decision: when a
  finding carries a policy half, ask about the policy.
- **Sibling repo.** The fix belongs to Clan, Drop, elixir-bot, the Discord
  preview or cr-agent-api-docs. Fix it there under that repo's rules and
  lease, in the domain lease order (`../AGENT-TEAM/WORKFLOW.md`).
  poapkings.com is report-only (Jamie, 2026-09-25: "leave poapkings.com
  website as is for now even if it is wrong").

Put the product calls to Jamie **one at a time** with AskUserQuestion,
up to four per round, each with the recommendation first and marked
"(Recommended)". Give the evidence in the question, not a pointer to the
report. Every answer becomes a DECISIONS line in the fix phase.

**Stop and ask before** any of these, even when it looks like a defect:
- deleting production rows or dropping a column or schema,
- removing a file that is untracked (commit it first, then prune; git
  keeps it),
- a JSON API response change that is not additive (a JSON API major),
- anything a `DECISIONS.md` declined idea covers.

## Phase 4: fix and guard

- Workers may edit in parallel only on disjoint files. Give each a file
  list; you commit.
- Fix at the source, then every surface `facets.md` lists for it. A
  decision realized in a tool and not in its second derivations is the
  pattern this skill exists for.
- **Guard.** Each class in `classes.md` names its guard. A finding whose
  class can be checked mechanically gets that test or acceptance check in
  the same round; a rule nothing enforces does not survive the round that
  found it. The guards added on 2026-09-25 are the model: the JSON API pin,
  the migration rules, the brief naming every segment tool, `season`
  wherever `from` is, and the retired-names ban.
- Artifacts: before archiving or removing anything, grep the whole domain
  for pointers to it and repoint them. Migrations are checksum-immutable
  and may cite old paths; `docs/archive/README.md` keeps the old-to-new
  path table.
- Ledger in the same round: a line in `docs/DECISIONS.md` for every
  decision Jamie made, the stale lines rewritten, a dated entry in
  `docs/NOTES.md`, and ENGINEERING.md where an invariant changed.
- A contract change follows the versioning rules (AGENTS.md rule 5): one
  MCP bump for the round, a changelog entry, `updates.js` for anything a
  user sees; a JSON API change moves `info.version` and the pin.

## Phase 5: ship

1. `npm run verify`. It must reach the tests; a knip failure stops before
   them.
2. Commit in logical chunks (docs and artifacts, ops and migrations, code,
   site docs, ledger), each message-first, and check that HEAD moved.
3. Push, then deploy:
   `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs --acceptance`.
   A sweep touches shared code, so it runs the whole suite; a trace that
   touched one family may pass `--acceptance=<family>`.
4. **Triage every acceptance failure.** The suite is how 2026-09-25's
   9.1.0 found a note still naming a removed field. For each failure:
   - fix forward (a new patch) when the product is wrong,
   - amend a case the round's decisions changed, with an `amended` reason,
   - allow a real but rare field in `catalogue-allow.json` with a reason,
   - keep a `known.json` entry only with a current reason and an expiry,
   - re-run a suspected flake alone (`node acceptance/run.mjs --only <id>`)
     before calling it one.
   Never delete a control case: every finding keeps one.
5. Sibling repos last, after the hub they depend on is live. Their gates,
   their deploys, their leases, released when done.

## Phase 6: close

- The report in `reports/<date>-<trace-slug|sweep>.md`: what was
  reviewed (HEAD, versions), findings by class with verdicts, Jamie's
  calls, what shipped (commits, versions, acceptance result), what is
  queued, and the coverage list of what was checked and found consistent.
- Memory: update the memories the round changed, and one memory for the
  round's decisions if it had any.
- Release every lease you claimed.
- The message to Jamie: what landed, what acceptance caught, and a short
  **Needs you** list (live checks only Jamie can do, sibling work that is
  not ours, open questions). Times in US Central.

## Standing rules

- Read-only until the lease is held; subagents are always read-only.
- Never read `.env` files or secret values; the public repos hold none.
- DECISIONS.md is the ledger agents read. When a finding is "the ledger
  says X, the agents were never told", the fix is the reading path
  (AGENTS.md, `AGENT-TEAM/READING.md`, the objective files, the skills),
  not another copy of X.
- Do not re-litigate a DECISIONS line. A surface that disagrees with it is
  the defect; a line that contradicts another line is a product call.
- The Gym tests tool families adversarially; this skill checks that
  decisions are realized across surfaces. A Gym finding about one tool is
  not a consistency finding unless another surface disagrees with it.
