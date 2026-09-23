---
name: gym
description: Run the Elixir Gym, the adversarial consumer-agent tester for the MCP tool families, as subagents on the Gym's own account. `/gym` runs one run on today's rotation; `/gym <family>` runs one family; `/gym sweep` loops over all ten families (Gym run, fix, deploy, re-run) until each has a clean run. Use for Gym runs, the pre-launch stability sweep, or re-checking a family after a fix.
---

# The Elixir Gym

The Gym is the tester that fails the way a stranger's agent fails. It finds
payloads where correct data leads a competent agent to the wrong conclusion.
Its brief is `brief.md` in this directory: Jamie's prompt, unchanged except
where running here requires it. **You orchestrate; subagents are the
Gym.** Never do a Gym run's work in your own context. Your job is to
assign, collect, fix, deploy and keep the grid.

Why it exists (Jamie, 2026-09-23): Elixir is not public yet. The first
outside user's experience must not be finding bugs. The sweep's exit is the
build we announce.

## Scope: ten families, MCP only

`badges`, `battles`, `cards`, `clans`, `collections`, `elixir`, `game`,
`players`, `rankings`, `war`

These are the tool-name prefixes. `live_*` is out, and so are the web app,
email and REST: they derive from the MCP (Jamie, 2026-09-23). The grid is
`coverage.md` in this directory.

## The Gym's account

- **Principal:** the `gym` agent, created 2026-09-23, owned by Jamie.
  - Clan: POAP KINGS `#J2RGCRVG`.
  - Scope: `cr:read feedback:write`.
  - Door: `https://elixir.poapkings.com/a/cd9e89e10d09/mcp`.
- **Budget and history:** it spends from its own hourly bucket, not Jamie's
  and not the Discord agent's. The feedback it files is its own, so the call
  audit and the queue can tell Gym traffic from people.
- **Credentials:** `call.mjs` reads the token from `.env` here (mode 0600,
  ignored by git). Never print, cat or read the token.
- **Re-minting** follows the acceptance recipe in `acceptance/README.md`,
  with name `gym`, scope `cr:read feedback:write`, and the `.env` path here.
- **Queued for Jamie:** raise its ceiling with
  `{service_token_limits: {name: "gym", hourly_rate_limit: 900}}` on
  `elixir-mcp-migrate`, the same ceiling `acceptance` has. The op was not
  run on 2026-09-23 because the session's permission check refused a live
  write. Until it is run, the principal's tier default applies, and a
  `rate_limited` refusal says what that is.

Subagents also inherit Jamie's own `mcp__elixir-mcp__*` connection. The
brief forbids them from using it, and your assignment header repeats that.

## One run: `/gym` or `/gym <family>`

1. **Preflight.**
   - Check that the connection answers: `node .claude/skills/gym/call.mjs game_clock '{}'`.
   - Check that `acceptance/gym.json` parses.
   - No lease is needed. A Gym run writes only its report, under
     `reports/` (ignored by git).
2. **Build the legacy list.** Findings #1–#89 were filed from Jamie's
   account, before the Gym had its own.
   - Read them with Jamie's connection (`mcp__elixir-mcp__elixir_my_feedback`,
     every page), or with the migrate op `{feedback_read}`.
   - Keep the items that touch the assigned family.
   - Give each item one line: id, status, `shipped_in`, tool, what was wrong.
     Keep it short; this is the regression and exclusion input, not the history.
3. **Assign.** Spawn ONE `general-purpose` subagent with this prompt:

   ```
   You are the Elixir Gym. Read /Users/otto/Projects/clash-royale/elixir-mcp/.claude/skills/gym/brief.md
   in full and follow it exactly. Work from the repo root.

   ASSIGNMENT HEADER
   Date: <YYYY-MM-DD>
   Family: <family> (assigned by <sweep round N | /gym>)  — or "rotation" for bare /gym
   Report path: .claude/skills/gym/reports/<date>-<family>-r<N>.md
   Connection: node .claude/skills/gym/call.mjs ONLY. Never use mcp__elixir-mcp__* tools.
   Legacy list (filed from Jamie's account before 2026-09-23; treat as your own history):
   <the lines>
   Shipped since the last run of this family: <versions and one line each, if a sweep round>
   Scratch files: /tmp/gym-<family>/ only (Gyms running together collided in one directory on 2026-09-23).
   ```

4. **Check the appendix** with
   `node .claude/skills/gym/check-appendix.mjs <report>`. If it fails, send
   the problems back to the same subagent (SendMessage) to fix. Never fix
   the Gym's cases yourself: nothing is hand-translated.
5. **Record the result** in `coverage.md`. The run is **clean** when:
   - it filed no new findings (`praise` does not count),
   - every regression it checked was CONFIRMED FIXED.

   Open questions are not findings: carry them into the grid's notes.

## The sweep: `/gym sweep`

The loop Jamie asked for (2026-09-23): as many runs as it takes, not one a
day, until every family has a clean run on the build we will announce.

**Order.**
1. Families with no clean run yet, in list order.
2. Families whose last clean run predates a deploy that touched them.

`elixir`, `game`, `badges` and `collections` are light. `battles`, `cards`
and `rankings` read the corpus and are heavy on the db.t4g.micro.

**Parallelism.**
- At the account's 300 calls an hour, ONE Gym at a time: a full run spends
  150-250 calls, and on 2026-09-23 badges and battles together emptied the
  hour so the next two runs were refused at their first call. Up to two at
  once only after Jamie raises the ceiling to 900.
- Never two heavy families together.
- If a `rate_limited` refusal comes back, drop to one and wait for the hour.

Gym runs are read-only, so they may run while you fix another family.

**Per family, per round:**
1. **Run** the Gym on it, as in "One run".
2. **If the run is clean,** mark the family clean in the grid, noting
   contract version and date, and move on.
3. **If the run has findings, fix them. Jamie's standing authority for the
   sweep: fix and deploy without asking.** Work it the Close the Loop way
   (`AGENT-TEAM/close-the-loop.md`):
   - Claim the `loop` lease: `AGENT-TEAM/scripts/objective-lease.mjs claim loop`.
   - Verify every finding against the record before touching code. The Gym
     is evidence, not authority. A finding you refute gets an answer with
     the evidence, not a fix.
   - Fix at the source. The site docs and `apps/site/src/_data/updates.js`
     go in the same commit.
   - Merge the report's appendix into `acceptance/gym.json` unchanged.
     Fetch each finding's bite:
     `acceptance/bites/fetch.mjs <date> <request-id prefix> <name> <feedback id>`.
     New verbs go into `acceptance/gym-interp.mjs`.
   - **One contract bump per family round**, not one per finding, which is
     the cadence rule. Majors are off the table in a sweep. Anything that
     would need one is a Jamie decision.
   - Run `npm run verify` and check that it reached the tests: a knip
     failure stops before them.
   - Deploy: `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs --acceptance`.
     Read the fix back live.
   - Answer each item with `{feedback_respond}`, `done` naming the version,
     following close-the-loop.md's write rules. Add a short `docs/NOTES.md`
     entry for the round. Commit, push, and release the lease.
4. **Re-run** the family (round N+1). The header says what shipped since.
5. **Stop the family after three rounds without a clean run.** Park it as
   `needs Jamie` with the reason and keep sweeping the others.

**Stop and ask Jamie instead of fixing** (park the family, continue the
rest):
- a fix that changes what a number MEANS rather than how it is described,
- a new tool,
- a refusal that breaks existing callers,
- anything touching a decision or declined idea in `docs/DECISIONS.md` (for example a branded
  metric, or the 7.0.0 refusals).

**The sweep ends when** all ten families are clean, or clean-or-parked. The
final message to Jamie has four parts:
- the grid,
- what shipped, with versions,
- the parked decisions, each as one question,
- whether the build is ready to announce.

Push a notification only for a regression of a shipped fix, a "blocks
correct answers" finding, or the sweep finishing.

## Standing rules

- Never read the token and never run `call.mjs` with output that could
  include it. It prints bodies, never headers.
- Gym subagents never edit the repo. You are the only writer, under the lease.
- The daily Claude Cloud routine (Jamie's connector, Jamie's budget) and a
  sweep double-file if both run. Jamie decides whether the cloud routine is
  paused or retired. Until he does, tell him when a sweep starts.
