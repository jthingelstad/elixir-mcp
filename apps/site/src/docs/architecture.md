---
slug: architecture
title: "Architecture"
description: "How Elixir MCP is built: the collector fleet, the recording pipeline, the Postgres corpus, and the authenticated remote MCP server behind one hostname."
section: record
order: 22
navTitle: "Architecture"
icon: layers
lede: "Collectors, the door, the job ledger, admission and retention."
---

# Architecture

How Elixir MCP is designed, for people who are curious and for anyone who
needs to reason about what the service will and won't do. **This page is the
description of record** — there is no fuller internal one, deliberately: a
second copy is how the previous one came to describe a model that had already
been replaced.

## The shape of the system

<svg viewBox="0 0 880 560" role="img" aria-label="Elixir MCP architecture"
     style="width:100%;height:auto;font-family:inherit">
  <style>
    .box { fill: none; stroke: var(--ink); stroke-width: 2.5; }
    .store { fill: none; stroke: var(--ink-faint); stroke-width: 1.5; stroke-dasharray: 6 4; }
    .lbl { fill: var(--ink); font-size: 16px; }
    .sub { fill: var(--ink-faint); font-size: 12px; font-style: italic; }
    .edge { stroke: var(--ink-faint); stroke-width: 1.5; }
    .note { fill: var(--gold); font-size: 11.5px; }
  </style>
  <!-- consumers -->
  <rect class="box" x="20" y="20" width="230" height="90"/>
  <text class="lbl" x="135" y="70" text-anchor="middle">Claude, ChatGPT, …</text>
  <rect class="box" x="325" y="20" width="230" height="90"/>
  <text class="lbl" x="440" y="60" text-anchor="middle">Web interface</text>
  <text class="sub" x="440" y="82" text-anchor="middle">explorer speaks the same tools</text>
  <rect class="box" x="630" y="20" width="230" height="90"/>
  <text class="lbl" x="745" y="70" text-anchor="middle">elixir-bot</text>
  <!-- auth edges -->
  <line class="edge" x1="135" y1="110" x2="330" y2="200"/>
  <text class="note" x="175" y="165">MCP / OAuth</text>
  <line class="edge" x1="440" y1="110" x2="440" y2="200"/>
  <text class="note" x="448" y="165">email session</text>
  <line class="edge" x1="745" y1="110" x2="550" y2="200"/>
  <text class="note" x="620" y="165">service token</text>
  <!-- core -->
  <rect class="box" x="90" y="200" width="700" height="110"/>
  <text class="lbl" x="255" y="262">Elixir MCP</text>
  <rect class="store" x="430" y="222" width="160" height="66"/>
  <text class="sub" x="510" y="260" text-anchor="middle">PostgreSQL</text>
  <rect class="store" x="605" y="222" width="160" height="66"/>
  <text class="sub" x="685" y="252" text-anchor="middle">S3 archive</text>
  <!-- queue -->
  <line class="edge" x1="240" y1="310" x2="180" y2="390"/>
  <line class="edge" x1="440" y1="310" x2="440" y2="390"/>
  <line class="edge" x1="640" y1="310" x2="700" y2="390"/>
  <text class="note" x="452" y="352">work queue — priority-ordered by Elixir MCP</text>
  <text class="note" x="452" y="368">(collectors never choose targets)</text>
  <!-- collectors -->
  <rect class="box" x="70" y="390" width="220" height="70"/>
  <text class="lbl" x="180" y="432" text-anchor="middle">Collector 1</text>
  <rect class="box" x="330" y="390" width="220" height="70"/>
  <text class="lbl" x="440" y="432" text-anchor="middle">Collector 2</text>
  <rect class="box" x="590" y="390" width="220" height="70"/>
  <text class="lbl" x="700" y="432" text-anchor="middle">Collector n</text>
  <!-- CR API -->
  <line class="edge" x1="180" y1="460" x2="360" y2="510"/>
  <line class="edge" x1="440" y1="460" x2="440" y2="510"/>
  <line class="edge" x1="700" y1="460" x2="520" y2="510"/>
  <text class="note" x="452" y="492">IP-bound keys · ONE shared rate budget, fleet = resilience</text>
  <rect class="box" x="90" y="510" width="700" height="42"/>
  <text class="lbl" x="440" y="537" text-anchor="middle">Clash Royale API</text>
</svg>

Everything cloud-side is serverless (Lambdas + SQS + RDS Postgres,
NAT-free VPC). The only machines with Clash Royale API keys are
**collectors** — operator-run workers that lease fetch jobs from the
queue, fetch with their IP-allowlisted key, and post results back. They
never choose their own targets, hold no user data, and earn ladder
points per call. The fleet shares **one global rate budget** by design:
more collectors mean resilience, never more API load.

## Collectors, in depth

A collector is a single static binary, Go or Python (its own public repo,
[elixir-mcp-collector](https://github.com/jthingelstad/elixir-mcp-collector))
that runs anywhere with a static IP — a Mac in a closet, a Synology NAS
at a cabin. What makes the fleet interesting:

- **Card identities.** Every collector is named after a Clash Royale
  card and appears publicly only by that card name — machine labels and
  IPs stay private. The console's [Status](/status/service) page shows
  each card's heartbeat and hourly fetch rate, and `/api/public/status`
  publishes the same fleet without a session.
- **Credits.** Fetches earn points, and points convert to the
  operator's own daily tool-call quota at 10:1 (capped at 4× the tier
  base). Running a collector literally buys your agent more questions.
- **Zero trust, zero AWS.** A collector holds exactly two secrets: its
  operator's own IP-bound Clash Royale key, and a bearer token we
  issue. It speaks three HTTPS routes (config / lease / submit) —
  no AWS credentials, no queues, nothing that touches the tenant. The
  server computes each job's CR path and stamps the collector's
  identity onto results itself, so impersonation is structurally
  impossible and collection changes never require a client update.
- **Channels.** Operator collectors serve the bulk channel only —
  scheduler-chosen work, polled lazily. The live channel (user-facing
  fetches) runs exclusively on machines we operate.
- **Self-update, server-authorized.** The config endpoint names the one
  binary version and SHA-256 a collector may install — a compromised
  release page alone cannot push code to operators. An update failure
  never stops collection; a dev build never self-updates.
- **Misbehavior is bounded.** At most two unsubmitted leases at a time;
  leases that expire unsubmitted redeliver their jobs and count against
  the collector, and a collapsing submit ratio quarantines it
  automatically. Every payload is provenance-stamped forever, so even a
  late-discovered bad actor's data can be purged and replayed away.
- **Capture audit.** Every fresh battle-log poll with prior coverage is
  audited: if the payload's *oldest* battle was previously unseen, the
  rotating log may have rolled past something — recorded as a possible
  gap. The 24-hour gap count is public on Status, so "no gaps" is a
  measurement, not a promise.

## The push lane and the Clan Pulse

Recording is pull; noticing is push. Everything you add feeds a
per-account **event feed** (`elixir_events`) while its notify switch is
on: battles recorded (coalesced per tag), clan membership changes, war
weeks finishing, feedback responses. Two events exist specifically so a
**scheduled agent routine can help run a clan**: a real-time
`war_day_open` when a new war day is first observed, and one
`clan_pulse` digest per added clan each day — 24-hour battle activity,
quiet members, war-day deck counts, roster changes. The digest carries
facts, never judgments; what to do about a member quiet six days is
deliberately your agent's call, not the service's. The recipe lives on
[Events and the clan pulse](/docs/events).

## The feedback loop

Feedback is a first-class product surface, not a mailbox. Agents file
it mid-session with `elixir_feedback` (attributed to the connecting
account); people file it on the site. Every item gets a maintainer
response — `elixir_my_feedback` shows the full ledger, a
`feedback_responded` event lands in your feed, and shipped fixes link
the change. The same loop feeds the public
[Changelog](/data/changelog): contract versions are machine-readable
(`elixir_changelog`), so an agent can ask "what changed since 0.20?"
and discover capabilities that landed mid-session. Several shipped
tools trace directly to agent-filed feedback.

## The outbound relay

The VPC has no NAT — cloud components cannot reach the internet at
all, which is a security posture worth keeping. The one exception is a
small non-VPC **relay** Lambda fed by a queue. It does three jobs with
deliberately different guarantees: transactional email (magic-link
codes via JMAP — retried hard, dead-lettered loudly), anonymous
[Tinylytics](https://tinylytics.app) product events (best-effort,
dropped on failure), and newsletter enrollment at sign-in (Buttondown;
idempotent, and an unsubscribed address is never re-subscribed). An
analytics outage can never page anyone or delay a login email.

## Recording: record once, entitle many

- **Canonical battles.** The same battle appears in every participant's
  battle log; we store it once under a content-derived ID (time +
  sorted participant tags + battle class). Later observations *enrich*
  the record (fill missing fields) but never overwrite it.
- **Payloads and receipts.** Every API response is content-addressed
  and receipted with which collector fetched it and when. Projections
  (battles, snapshots, war tables) are derived from payloads and are
  rebuildable from source.
- **The S3 payload archive.** New payload content is archived to S3 at
  admission (Hive-partitioned by endpoint, entity, and date; gzip JSON;
  lifecycle to Infrequent Access at 30 days) before the database commit
  — a committed row always has its S3 twin. S3 is the system of record
  for raw observations; Postgres keeps the latest payload per entity as
  the hot serving set, and a weekly sweep retires superseded rows only
  after verifying their archived copy. Athena (via one Glue table with
  partition projection) and DuckDB both query the layout directly.
- **Snapshots and events.** Daily profile snapshots feed trophy/donation
  timelines; diffs between polls emit events with honest time semantics
  (most things are "observed between polls", and the data says so).
- **War data.** Clan-scoped, multi-tenant (every war table is keyed by
  the observing clan), points-vs-fame discipline enforced at write time,
  and a per-clan war clock resolves battles to seasons/weeks/days from
  their own timestamps.

## Scheduling: how often a player is fetched, and why

The official API is current-state only: a player's battle log holds
roughly the last 30 battles and nothing older. Recording therefore means
fetching often enough that no battle rolls off the log before a collector
has seen it, while the whole fleet stays inside one shared, conservative
API budget. The scheduler decides who is fetched when, from four rules
that only ever shorten each other:

- **Observed yield sets the base cadence.** Each recorded player carries
  an exponentially-weighted average of battles-per-hour actually
  harvested. The battle log is fetched when about five new battles are
  expected, clamped between 15 minutes and 24 hours, so an active player
  is polled tightly and a dormant one falls to daily on its own. A
  newly added player starts at an hourly discovery cadence.
- **A loss-aware bound stops bursts from rolling off.** Yield learns
  from what a poll harvested, which is exactly what an overflowed log
  hides: a poll that returns 30 unseen battles after six hours reads as
  five an hour when the player may have played sixty. So at every
  admission the recorder also measures, from the battle timestamps
  themselves, the fastest this player has recently filled the log (the
  busiest six-hour window of the last 14 days), and polls before half
  that time has passed. A grinder who fills the log in two hours is
  fetched every hour for as long as that pace stays in their recent
  history; everyone else is unaffected.
- **A reader cap keeps the players you ask about fresh.** Asking about a
  player through any tool marks that player as read, and their battle
  log then stays within an hour for the next day. Without this, a
  friend who plays a few games a day sits on the daily floor and can be
  a day stale precisely when you look. Reading costs nothing beyond the
  call itself; the extra fetches are a small, bounded slice of the
  budget.
- **Fairness floors guarantee nobody is forgotten.** Whatever the
  signals say, every recorded player's battle log is fetched at least
  daily and their profile at least every three days.

Profiles are polled less often than battle logs (every eight hours for
active players, daily for most, every three days for dormant ones),
because the record keeps one snapshot per day; the one time-critical
profile read, the pre-reset capture of the weekly donation counter, is
forced separately. Clan rosters are read every 15 minutes, and war-race
polling reads the period type the API itself reports: tight on war days,
relaxed on training days, with the war race also raising the battle-log
cadence of members it names as having just battled. Because every
cadence is a pure function of a player's state, subjects added together
would otherwise fall due together forever; a stable per-subject phase
offset de-phases such cohorts within a few cycles.

What this means when you read: every response carries the age of the
polls it was built from (`freshness_seconds` in `meta`), `elixir_coverage`
compares the lifetime battle counter against what was recorded over each
observation interval and says so when they disagree, and the public
[status page](/status/service) reports how many of the last day's polls
found the log had already rolled - as does `capture_audit_24h` in
`/api/public/status`. When you need the state of play right
now rather than the recorded history, `live_fetch` spends your live
allowance on a fresh read instead of waiting for the schedule.

## Access: entitlements, not permissions

- A **claim** on your tag (trust-based; accounts are owner-approved)
  gives your agent your full history — including battles recorded
  before you joined.
- **Universal game reads**: recorded player data — battles, profiles,
  timelines — is readable by every approved account, the same posture
  as the game's own public API. **Clan cover** gates the clan-scoped
  tools (roster, war): open members of a recorded clan use them, and
  that access ends the moment membership ends.
- The MCP door is OAuth 2.1 with rotating refresh tokens. `cr:read` is the
  baseline, while recordings, collections, account preferences, and
  feedback each require their own write capability. The consent page
  names every requested capability, refresh never expands it, and an
  insufficient tool call is refused before it spends rate or daily
  quota.
- **Three principals, three doors.** A person connects at
  `/mcp`; an agent at `/a/<id>/mcp`. Platform integrations use the
  [REST API](/docs/integrations) at `/api/v1`; `/i/<id>/mcp` remains a legacy migration surface.
  Grants are audience-bound to exactly one of them, so a credential
  presented at the wrong door is refused rather than quietly answering
  about the wrong subject — which matters because the three publish
  different tool surfaces and mean different things by "me". See
  [Users, agents and integrations](/docs/connections).
- Service tokens are for **headless** principals — a Discord bot, a
  scheduled job, an app back end — and carry only the capabilities they
  were issued with. A human driving an agent signs in and consents
  instead, and never handles a raw key. The site uses cookie sessions;
  every tool call is audited against the credential that made it, with
  visible per-account quotas.

## Honesty machinery

Coverage tools report recording start, per-endpoint freshness, and
completeness ratios; timelines disclose their epochs; empty windows and
inverted ranges refuse rather than pretending. The rule throughout: the
system must never present a partial record as a complete one.

## Operations

CI-gated public repo; collectors self-update from released builds;
alarms route to an operations queue drained daily; performance is
censused continuously (every ingest message logs phase timings). The
database is audited periodically and raw payloads live in an S3
archive, content-addressed and queryable with SQL over S3. Site visits
are counted anonymously with Tinylytics — see [Privacy](/docs/privacy)
for exactly what that means.

The web API assembles feature-specific route modules behind shared session
resolution. The account application separates overview, agents, connections,
usage and feedback pages. The migration Lambda dispatches operational commands
to separate modules; ordered migrations still run only through its deploy path.
The shared metadata contract is checked when an envelope is built and after a
tool returns. Successful UI journeys exercise the real API on scratch databases.

CI and local development use the same `npm run verify` gate: formatting, lint,
dead-code analysis and workspace tests.

## The code, and the family

Elixir MCP is built in the open:

- [jthingelstad/elixir-mcp](https://github.com/jthingelstad/elixir-mcp)
  — this service: recorder, MCP door, web app, and these pages
  (the docs you are reading are the source of record; `docs/ENGINEERING.md`
  holds the build invariants).
- [jthingelstad/elixir-mcp-collector](https://github.com/jthingelstad/elixir-mcp-collector)
  — the collector binary operators run.
- [jthingelstad/elixir-bot](https://github.com/jthingelstad/elixir-bot)
  — Elixir Agent, the POAP KINGS clan agent; it consumes this service
  over a service token.
- [jthingelstad/drop.poapkings.com](https://github.com/jthingelstad/drop.poapkings.com)
  — Elixir Drop, the elixir-cost learning game; its collector-bridge
  and mailing-list patterns are this service's direct ancestors.

All of it orbits [POAP KINGS](https://poapkings.com), the clan.
