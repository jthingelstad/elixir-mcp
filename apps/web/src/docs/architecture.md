# Architecture

The technical documentation — how Elixir MCP is designed, for users who
are curious and admins who need to reason about it. The full spec of
record lives in the public repo (`docs/DESIGN.md`); this is the
maintained distillation.

## The shape of the system

<svg viewBox="0 0 880 560" role="img" aria-label="Elixir MCP architecture"
     style="width:100%;height:auto;font-family:inherit">
  <style>
    .box { fill: none; stroke: var(--ink); stroke-width: 2.5; }
    .store { fill: none; stroke: var(--faint); stroke-width: 1.5; stroke-dasharray: 6 4; }
    .lbl { fill: var(--ink); font-size: 16px; }
    .sub { fill: var(--faint); font-size: 12px; font-style: italic; }
    .edge { stroke: var(--faint); stroke-width: 1.5; }
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
  <text class="sub" x="685" y="270" text-anchor="middle">(building)</text>
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

## Recording: record once, entitle many

- **Canonical battles.** The same battle appears in every participant's
  battle log; we store it once under a content-derived ID (time +
  sorted participant tags + battle class). Later observations *enrich*
  the record (fill missing fields) but never overwrite it.
- **Payloads and receipts.** Every API response is content-addressed
  and receipted with which collector fetched it and when. Projections
  (battles, snapshots, war tables) are derived from payloads and are
  rebuildable from source.
- **Snapshots and events.** Daily profile snapshots feed trophy/donation
  timelines; diffs between polls emit events with honest time semantics
  (most things are "observed between polls", and the data says so).
- **War data.** Clan-scoped, multi-tenant (every war table is keyed by
  the observing clan), points-vs-fame discipline enforced at write time,
  and a per-clan war clock resolves battles to seasons/weeks/days from
  their own timestamps.

## Scheduling: spend the budget by expected value

The scheduler maintains one prioritized queue. Each subject's cadence
derives from its **observed yield** — an exponentially-weighted average
of battles-per-hour actually harvested — so active players poll tightly
and dormant ones fall to daily, automatically. War-race polling reads
the period type the API itself reports (war days tight, training days
relaxed). Fairness floors guarantee nobody is forgotten regardless of
yield.

## Access: entitlements, not permissions

- A **claim** on your tag (trust-based; accounts are owner-approved)
  gives your agent your full history — including battles recorded
  before you joined.
- **Clan cover**: open members of a recorded clan read clan data and
  fellow members' history, ending the moment membership ends. Being in
  a clan *is* sharing your battles with it, exactly as in the game.
- The MCP door is OAuth 2.1 with rotating refresh tokens; the site uses
  cookie sessions; every tool call is audited per surface with visible
  per-account quotas.

## Honesty machinery

Coverage tools report recording start, per-endpoint freshness, and
completeness ratios; timelines disclose their epochs; empty windows and
inverted ranges refuse rather than pretending. The rule throughout: the
system must never present a partial record as a complete one.

## Operations

CI-gated public repo; collectors self-update from green main; alarms
route to an operations queue drained daily; performance is censused
continuously (every ingest message logs phase timings). The database is
audited (`docs/DB-AUDIT.md`) and raw payloads are bound for S3 archive
with SQL-over-S3 tooling (`docs/DATA-TOOLS.md`).
