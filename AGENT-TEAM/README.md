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

| Objective | Key | File | Primary question |
|---|---|---|---|
| **Elixir Operator** | `run` | `elixir-operator.md` | Is the recorder pipeline healthy end to end — the job ledger draining, collectors heartbeating, doors serving, cost visible and intended? |
| **Elixir Data Auditor** | `record` | `elixir-data-auditor.md` | Is what we recorded actually what happened in the game — and do our docs and projections still match the live API? |
| **Elixir Feedback Manager** | `loop` | `elixir-feedback-manager.md` | Is feedback (human AND agent) plus call-audit signal turning into responses, shipped improvements, and honest docs? |
| **Elixir Security Reviewer** | `guard` | `elixir-security-reviewer.md` | Are entitlements, privacy boundaries, the public repo, secrets, and the one-key rate-budget posture actually holding? |
| **Elixir Rankings Analyst** | `boards` | `elixir-rankings-analyst.md` | Did every leaderboard snapshot land, is a top-200 appearance recording the player for the season, and do the board-driven collections equal today's board? |

Calendar cadence: [generated schedule](SCHEDULE.md), sourced from `automations.toml`.
Each run works in its own worktree ([WORKFLOW](WORKFLOW.md), "One
worktree per run").

Renamed 2026-09-29, for names that say what each does: Run Elixir MCP,
Keep the Record True, Close the Loop, Guard the Door and Keep the Boards.
The keys, the automation ids and each objective's memory did not change;
notes and summaries written before then use the old names.

The Elixir Security Reviewer is an independent control: the Operator
cannot waive its findings, and it never weakens an entitlement or
privacy boundary to make another objective's work easier. Do not add an
Analyst, Evaluator, or Cost Optimizer role — those outcomes already have
owners (cost → the Operator, data meaning → the Data Auditor, quality
judgment → the Feedback Manager).

## How Jamie engages the team

Start with the outcome instead of choosing a role or preparing a ticket:

- `Run <objective> now and own the highest-impact measured gap.`
- `Investigate <symptom>; choose the owner by the failed outcome, not the file.`
- `Show me team status only; make no changes.`
- `What across this team needs Jamie?`
- `Resume the active watch for <objective or issue>.`

Choose **Elixir Operator** for pipeline health, queues, collectors,
deploys, recovery, or cost; **Elixir Data Auditor** for game facts,
payload meaning, projection correctness, or CR API drift; **Elixir
Feedback Manager** when the machinery works but feedback sits unanswered, agents
stumble on tool ergonomics, or docs have gone stale; **Elixir Security Reviewer**
for secrets, entitlements, privacy, or ToS-posture questions; **Elixir
Rankings Analyst** for leaderboard snapshots, ranking presence and the
board-driven collections.
Cross-cutting work keeps one originating owner through acceptance.

## Boundaries with the neighbors

- **projects-sysadmin AGENT-TEAM** audits the whole AWS account and host
  weekly and drains the shared alarm queue daily. This team owns *this
  stack's* operational truth — the Operator sees that an alarm fired;
  Elixir Operator owns why, and the fix.
- **elixir-bot** is retired (stopped 2026-09-26): no boundary to keep,
  and nothing here waits on it. Contract changes still land server-side
  here first, for every consumer.
- **elixir-mcp-discord preview** has operational ownership in Elixir Operator
  and tool-friction/quality ownership in Elixir Feedback Manager. Its own repository
  rules govern fixes; host signal triage remains with Run Operations. The
  preview has no local game-data fallback and must never replay old activity.
- **Interactive Claude sessions** (Jamie-directed feature work) use the
  main checkout, which scheduled runs never edit; a second concurrent
  session makes its own worktree. Every actor that changes production (a
  deploy, a migration run, an ops-lambda write) claims the one lease
  first (`scripts/objective-lease.mjs`), shared by every worktree of this
  clone. The daily feedback-response duty belongs to the Elixir Feedback
  Manager; interactive sessions do not drain it.

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
  is an on-demand census, never a routine read — see Elixir Operator), the jobs
  lambda (sweeps, the activity row, the efficiency row), Postgres itself
  (`mcp_call_audit`, the job ledger, `capture_efficiency_daily`), and the
  alarms that fired. There is no CloudWatch dashboard, and a custom metric
  exists only to back an alarm (`docs/DECISIONS.md`); anything else rides
  the EMF log line, which Logs Insights reads. The console's `/console/status` page is
  signed-in; the public health reads are `/data/now` and
  `/api/public/status`.
- Gates: `npm run verify` before push; the `validate` check before
  merge (a PR is the only way into main); deploys, from main after it, via
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
4. Small, message-first commits on a branch; assert HEAD moved; main
   takes them through a PR merged on a green `validate` check.
5. A healthy no-op is a successful run. Do not manufacture work.

## Calendar implementation

All times above are America/Chicago. Scheduled starts can run a minute or two
late because the app adds jitter. Autonomous checks can finish outside Jamie's
project windows; nonurgent decisions wait for early morning or early evening.
The manifest records the installed schedule and prompt, including the explicit
repository directory when the app launches from Projects.
