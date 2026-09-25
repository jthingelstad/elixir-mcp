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
email and the `/api/v1` JSON API: the Gym does not test them, because they
derive from the MCP (Jamie, 2026-09-23). The grid is `coverage.md` in this
directory.

Out of scope for testing is not out of scope for fixing. Seven JSON API
operations serve a tool's result: `clans_participation`, `clans_roster`,
the `live_fetch` clan read, `players_names`, `players_profile`,
`battles_query` and `elixir_track_player` (`POST /api/v1/me/players`, 2.1.0) (wiring in `services/web-api/src/integration-api.mjs`,
contract in `packages/contracts/integration-api.openapi.json`). A fix to
one of those tools is checked against its operation before it ships. The
MCP versioning rule is MCP-only (majors track domain shifts; removing an
unreliable field is a patch), while the JSON API keeps ordinary semver, so
a Gym patch that removes or renames a field the operation returns would be
a JSON API major. A round that would change a JSON API response stops and
asks Jamie (see "Stop and ask Jamie").

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
   - The run itself needs no lease: the subagent writes only its report,
     under `reports/` (ignored by git). Recording the result in
     `coverage.md` (tracked) is a checkout write, so it is made under the
     `loop` lease, the same lease a fix round holds
     (`AGENT-TEAM/scripts/objective-lease.mjs claim loop`). If another
     actor holds the lease, the report waits and the grid is updated once
     it frees.
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
5. **Record the result** in `coverage.md`, under the `loop` lease. The
   run is **clean** when:
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
and `rankings` read the corpus and are heavy on the database (db.t4g.small
since 2026-09-23, after the sweep drained the micro's EBS byte balance).

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
     the evidence, not a fix. Its case still joins `gym.json` as filed, with
     a `refuted` field giving the answer; the interpreter skips it with
     that reason (148.1, 148.4: event content is outside the meta population
     by decision).
   - **Prune a refuted case once what it tests is gone.** When the field,
     argument or behavior a refuted case exercises has left the contract
     (a removed war-day field, a retired trophy band, a changed timeline
     order), delete the case from `gym.json`; git and the changelog keep
     it. Keep a refutation where the Gym misread data that still exists
     (148.x, 183.x, 234.1, 238.3, 248.x, 249.2, 264.x): it guards against
     the same misreading next time. A case marked `refuted` that says it
     is held for Jamie is an open question, not a refutation; carry it in
     the grid's notes.
   - Fix at the source. The site docs and `apps/site/src/_data/updates.js`
     go in the same commit.
   - Check the JSON API for the seven mirrored tools (see "Scope"). If the
     fix would change what the `/api/v1` operation returns, stop: park the
     family and ask Jamie.
   - Merge the report's appendix into `acceptance/gym.json` unchanged.
     Fetch each finding's bite:
     `acceptance/bites/fetch.mjs <date> <request-id prefix> <name> <feedback id>`.
     New verbs go into `acceptance/gym-interp.mjs`.
   - **One contract bump per family round**, not one per finding, which is
     the cadence rule. Majors are off the table in a sweep. Anything that
     would need one is a Jamie decision.
   - Ship with `/ship` (`.claude/skills/ship/`), deploying with
     `--acceptance=<family>`: only that family's cases. A Gym deploy
     always names its family; the whole suite (`--acceptance`) is only
     for a change to shared code (protocol, tools.mjs, shared.mjs,
     ingest). On 2026-09-23 a full gate on every deploy, plus the Gym
     runs, drained the database's EBS byte balance in one afternoon.
     A change to a tool follows `/tool-change`.
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
  metric, or the 7.0.0 refusals),
- a change to a JSON API response (a fix to `clans_participation`,
  `clans_roster`, the `live_fetch` clan read, `players_names`,
  `players_profile` or `battles_query` that alters what its `/api/v1`
  operation returns).

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
- The daily Claude Cloud Gym routine is retired (Jamie, 2026-09-25); this
  skill replaces it. Do not re-create it: it ran on Jamie's connector and
  budget and double-filed against a sweep.
