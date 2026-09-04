# Architecture

The technical documentation — how Elixir MCP is designed, for users who
are curious and admins who need to reason about it. The full spec of
record lives in the public repo (`docs/DESIGN.md`); this is the
maintained distillation.

## The shape of the system

```
CR API ⇄ collectors (operator machines, IP-bound keys)
            ⇅ SQS request/results queues
scheduler λ ─→ one prioritized request queue
results ─→ ingest λ ─→ PostgreSQL (canonical record)
                          ⇡
        MCP server λ  ⇄  agents (OAuth 2.1)
        web API λ     ⇄  this site (sessions)
```

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
