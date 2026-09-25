# AGENT-TEAM — objective owners for Elixir MCP

Five objective owners maintain Elixir MCP. Each owns a durable outcome —
not a task type — and follows evidence through diagnosis, implementation,
verification, and production acceptance itself. There is no dispatcher,
Build Manager, or routing pipeline; building and testing are capabilities
of every owner.

This project needs a standing team more than most: data moves
continuously (collectors → the job ledger → projections → the record), and two
feedback loops run at once — human feedback on the site and agent
feedback arriving mid-session over MCP. Silence in either loop is a
defect somewhere.

## The team

| Objective | File | Primary question |
|---|---|---|
| **Run Elixir MCP** | `run-elixir-mcp.md` | Is the recorder pipeline healthy end to end — the job ledger draining, collectors heartbeating, doors serving, cost visible and intended? |
| **Keep the Record True** | `keep-the-record-true.md` | Is what we recorded actually what happened in the game — and do our docs and projections still match the live API? |
| **Close the Loop** | `close-the-loop.md` | Is feedback (human AND agent) plus call-audit signal turning into responses, shipped improvements, and honest docs? |
| **Guard the Door** | `guard-the-door.md` | Are entitlements, privacy boundaries, the public repo, secrets, and the one-key rate-budget posture actually holding? |
| **Keep the Boards** | `keep-the-boards.md` | Did every leaderboard snapshot land, is a top-200 appearance recording the player for the season, and do the board-driven collections equal today's board? |

Calendar cadence: [generated schedule](SCHEDULE.md), sourced from `automations.toml`.

Guard the Door is an independent control: Run cannot waive its findings,
and it never weakens an entitlement or privacy boundary to make another
objective's work easier. Do not add an Analyst, Evaluator, or Cost
Optimizer role — those outcomes already have owners (cost → Run,
data meaning → Keep True, quality judgment → Close the Loop).

## How Jamie engages the team

Start with the outcome instead of choosing a role or preparing a ticket:

- `Run <objective> now and own the highest-impact measured gap.`
- `Investigate <symptom>; choose the owner by the failed outcome, not the file.`
- `Show me team status only; make no changes.`
- `What across this team needs Jamie?`
- `Resume the active watch for <objective or issue>.`

Choose **Run Elixir MCP** for pipeline health, queues, collectors,
deploys, recovery, or cost; **Keep the Record True** for game facts,
payload meaning, projection correctness, or CR API drift; **Close the
Loop** when the machinery works but feedback sits unanswered, agents
stumble on tool ergonomics, or docs have gone stale; **Guard the Door**
for secrets, entitlements, privacy, or ToS-posture questions; **Keep the
Boards** for leaderboard snapshots, ranking presence and the
board-driven collections.
Cross-cutting work keeps one originating owner through acceptance.

## Boundaries with the neighbors

- **projects-sysadmin AGENT-TEAM** audits the whole AWS account and host
  weekly and drains the shared alarm queue daily. This team owns *this
  stack's* operational truth — the Operator sees that an alarm fired;
  Run Elixir MCP owns why, and the fix.
- **elixir-bot AGENT-TEAM** owns community facts and the clan agent's
  behavior. This team owns the recorded game facts elixir-bot consumes
  over its service token. Contract changes land server-side here first.
- **elixir-mcp-discord preview** has operational ownership in Run Elixir MCP
  and tool-friction/quality ownership in Close the Loop. Its own repository
  rules govern fixes; host signal triage remains with Run Operations. The
  preview has no local game-data fallback and must never replay old activity.
- **Interactive Claude sessions** (Jamie-directed feature work) share
  this checkout. Every mutating actor — objective run or interactive
  session — serializes through the checkout lease
  (`scripts/objective-lease.mjs`). Once this team's first runs are
  confirmed, the daily feedback-response duty belongs to Close the
  Loop; interactive sessions stop draining it.

## Project map

- `CLAUDE.md` / `AGENTS.md` — golden rules; `docs/ENGINEERING.md` is the spec
  of engineering invariants; `docs/DECISIONS.md` is the ratified-decision
  ledger, one line each; `docs/NOTES.md` holds the current week's working
  notes and `docs/notes/` the earlier weeks, where each decision's
  reasoning lives. `AGENT-TEAM/READING.md` selects authoritative product
  docs for each objective.
- `packages/contracts` — tool schemas, the collector and mail message
  contracts, error enum, changelog. Version rules in `docs/ENGINEERING.md`
  and `docs/DECISIONS.md`: the MCP contract's majors track domain shifts
  (removing an unreliable field is a patch), while the `/api/v1` JSON API
  keeps ordinary semver in its own `info.version`.
- `services/` — mcp (door + tools), web-api (site API + collector door),
  auth (the shared credential core), ingest, scheduler (plans the job
  ledger), migrate (deploy plumbing + break-glass ops), jobs (scheduled
  product work), and the two non-VPC Lambdas that are the only internet
  egress: email-relay (mail over SES, Buttondown enrollment) and editor
  (the Anthropic API for the written mails). The VPC Lambdas hand them
  work through the outbox bucket; the servers send analytics nothing.
- `~/Projects/clash-royale/elixir-mcp-collector` — the collector fleet's own repo;
  queue contract stays canonical here.
- `~/Projects/clash-royale/cr-agent-api-docs` — CR API truth; patch it when the live
  API surprises us.
- Live evidence: `https://elixir.poapkings.com/api/public/status` (including
  DB-backed collector heartbeat, admission, and recent-fetch signals), the
  migrate lambda ops (`{stats}`, `{tables}`, `{feedback_pending}`…; `{probe}`
  is an on-demand census, never a routine read — see Run Elixir MCP), the jobs
  lambda (sweeps, the activity row, the efficiency row), Postgres itself
  (`mcp_call_audit`, the job ledger, `capture_efficiency_daily`), and the
  alarms that fired. There is no CloudWatch dashboard, and a custom metric
  exists only to back an alarm (`docs/DECISIONS.md`); anything else rides
  the EMF log line, which Logs Insights reads. The console `/status` page is
  signed-in; the public health reads are `/data/now` and
  `/api/public/status`.
- Gates: `npm run verify` before push; deploys via
  `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs` (smoke-gated).
  Acceptance is opt-in per deploy, and `deploy.mjs` prints a WARNING when
  it is skipped: pass `--acceptance=<family>` whenever a tool in that
  family changes (read-only against the live door, after the code is
  live: a red case fails the deploy's exit, and you fix forward or roll
  back), and the whole suite, `--acceptance`, only for shared code
  (protocol, `tools.mjs`, `shared.mjs`, ingest) or a release.
  `npm run acceptance` runs it on demand.

## Ground rules that bind every owner

1. The repo is PUBLIC; secrets never enter it or agent context.
2. Never verify with writes on live data — reads and refusal paths only.
3. Docs ship with the change (site docs + `updates.js` same commit);
   contract bumps append to the changelog.
4. Commit to `main`; small, message-first commits; assert HEAD moved.
5. A healthy no-op is a successful run. Do not manufacture work.

## Calendar implementation

All times above are America/Chicago. Scheduled starts can run a minute or two
late because the app adds jitter. Autonomous checks can finish outside Jamie's
project windows; nonurgent decisions wait for early morning or early evening.
The manifest records the installed schedule and prompt, including the explicit
repository directory when the app launches from Projects.
