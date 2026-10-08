---
slug: limits
title: "Limits"
description: "Every quota and rate limit in one table, with the exact refusal each produces: the hourly bucket, daily tool calls, live fetches, slots, agents, OAuth registration, sign-in codes, the collector door and the REST API."
section: agent
order: 7
navTitle: "Limits"
icon: gauge
lede: "Calls per hour, calls per day, live fetches, and what a tier changes."
console: ["Your budget and what spent it", "/console/account/usage", "Console ▸ Usage"]
reviewed: "2026-10-06 against contract 11.2.3 and JSON API 3.0.0"
---

# Limits

Roles set the numbers; this page lists where each one is enforced and what a
refusal looks like. The per-tier numbers are on [Roles](/docs/roles).

## Windows and resets

| Kind | Window |
|---|---|
| Hourly buckets | fixed clock hour, UTC; not sliding |
| Daily quotas | UTC date; reset at 00:00 UTC (`meta.quota.resets_at`) |
| Slots | counted live against the account under a lock |

## The table

| Limit | Applies to | Bucket | Max | Refusal |
|---|---|---|---|---|
| MCP calls per hour | every credential on the door, keyed by the **budget account** (an agent spends its owner's) | `mcp#<account>` | 300 (per-token override possible) | HTTP 429 in the standard error envelope, `error.code` `quota_exceeded`, naming the ceiling that applied, with `meta.request_id` and a `Retry-After` giving the seconds left in the hourly window |
| Explorer calls per hour | the website's Explore page | same bucket as above | 300 | HTTP 429 `{"error":"rate_limited"}` |
| Tool calls per day | every `tools/call`, billed before the tool runs (a failed call still counts) | `mcpday#<account>` | role `mcp_calls_per_day` + collector credits (one per 10 collector points, a point being a fetch that added to the record), capped at 4× base; owner/admin unlimited | JSON-RPC `-32029` over HTTP 200: "Daily tool-call quota reached (N per day). It resets at midnight UTC." No `meta.quota` on this reply. |
| Explorer calls per day | the Console's Explore page and Ladder, whose reads are tool calls (Elixir Clan's reads and `/api/v1` spend none) | same bucket | same | HTTP 429 `{"error":"quota_exceeded","message":"Daily tool-call quota reached (N per day)…"}` |
| Live fetches per day | `live_fetch`, and `live: true` on {{ tools.liveFlagNames }}; every agent shares its owner's lane | `liveday#<account>` | role `live_fetches_per_day` or the account override; owner/admin unlimited | tool error `quota_exceeded`: "Live-fetch quota reached (N/day for the <role> tier, shared with your owner's other agents)." |
| Live fetches, fleet-wide | every new live read (the live lane, a JSON API profile refresh, a card first seen in a deck) | the one global bucket the scheduler plans from | one token per new live read, from the same bucket scheduled collection spends; it accrues at the fleet's rate (1 request per second by default), settles at each scheduler tick, and banks at most 300 seconds' worth | nothing is queued and nothing is charged against your own quota: `live_status` `pending` with `retry_after_s` at the next scheduler tick and a note saying the budget had no room; on `/api/v1` HTTP 429 `rate_limited` with `Retry-After` |
| Player slots | `elixir_track_player`, `POST /api/claims` | live count | 50 (member to partner), +2 with an active collector below partner; override `max_player_recordings` | MCP: `quota_exceeded` "Tracked players are capped at N for the <role> tier." Web: HTTP 429 same message |
| Clan slots, activity | `elixir_track_clan`, `POST /api/me/clans` | live count per scope | 1 / 1 / 3 / 10, +1 with an active collector below partner | `not_entitled` "The <role> tier has no activity-scope clan slots" or `quota_exceeded` "Your activity-scope clan slots are full (N for the <role> tier)." Web: HTTP 429 |
| Clan slots, comprehensive | same | same | 0 / 1 / 3 / 5 | same wording with `comprehensive` |
| Agents | `POST /api/me/agents` | live count | 3 / 5 / 10 / 25 | HTTP 400 `{"error":"not_entitled","reason":"agent_limit","limit":N,"role":"…"}` |
| OAuth client registration | `POST /oauth/register` | `dcr#<ip>`, `dcr#global` | 20 per hour per address; 5,000 per day in total | HTTP 429 `{"error":"temporarily_unavailable"}` |
| OAuth consent emails | `/oauth/authorize` step one | `oauthmail#<ip>`, `auth#<email hash>` | 10 per hour per address; 5 per hour per email, shared with the console's sign-in | silent: the page says "check your email" and no mail is sent |
| Sign-in emails (console) | `POST /api/auth` | `auth#<ip>`, `auth#<email hash>` | 10 per hour per address; 5 per hour per email, shared with OAuth consent | HTTP 200 with `limited: true` and a message saying the limit was reached; no mail is sent |
| Sign-in code attempts | code verification | per pending code | 5, then the code is dead | HTTP 400 `{"error":"invalid_or_expired","reason":"attempts_exhausted"}` (console); the OAuth page says "Too many attempts on that code" |
| Legacy access requests | `POST /api/request-access` | `reqaccess#<ip>` | 5 per hour | HTTP 429 `{"error":"rate_limited"}` |
| Role-upgrade requests | `POST /api/me/role-request` | pending state | one pending at a time | HTTP 409 |
| Verification starts | `POST /api/me/verify` | `verify#<account>`, `verify-tag#<tag>` | 5 per hour per account; 5 per hour per tag | HTTP 429 `{"error":"rate_limited","message":"At most 5 verification starts an hour."}` |
| Verification live reads | an open challenge's battle-log checks | per tag, last 24 hours | 120, whoever's challenges asked | none: the challenge stays open and the check waits for the player's regular recording |
| Feedback | `elixir_send_feedback`, `POST /api/v1/feedback`, a signed-in page's form | none | message 1 to 8,000 chars (the refusal says how long it was) | never metered beyond the daily call quota |
| Collector door, work | `/api/collector/lease` and `/submit` | `collector-work#<gateway>` | 10,000 per hour | HTTP 429 with `retry-after` and `{"error":"rate_limited","scope":"work","limit_per_hour":10000,"retry_after_s":N,"hint":"…"}` |
| Collector door, config | `/api/collector/config` | `collector-config#<gateway>` | 120 per hour | same shape, `scope: "config"` |
| Collector outstanding leases | `/api/collector/lease` | per gateway | 2 unsubmitted | HTTP 429 `{"error":"lease_cap","hint":"At most 2 unsubmitted leases; submit or wait 90s."}` |
| Collector quarantine | lease expiry | `missed_streak` | 10 expired leases in a row | HTTP 409 `{"error":"quarantined"}`; the collector drains and the maintainer is told |
| REST calls per hour | `/api/v1/*` | `rest-hour:<integration>` | per integration, default 2,000 | HTTP 429 problem `rate_limited`, `Retry-After` to the top of the hour |
| REST calls per hour, a person | `/api/v1/*` by a person's OAuth grant | `rest-person-hour:<account>` | 600; a first-party client (a family app's provisioned client) is not metered | HTTP 429 problem `rate_limited`, `Retry-After` to the top of the hour |
| REST calls per day | `/api/v1/*` | usage row | per integration, default 10,000 | HTTP 429 problem `daily_quota_exceeded`, `Retry-After` to UTC midnight |
| REST profile refreshes per day | `POST /api/v1/profile-refreshes` | usage row | per integration, default 1,000; an idempotent replay does not spend one | HTTP 429 problem `refresh_quota_exceeded`, `Retry-After: 3600` |
| Batch size | `players_names`, `POST /api/v1/players/names` | per call | 1 to 100 tags | tool error `bad_request`; on `/api/v1` HTTP 400 problem `bad_request` |
| Query budget | the analytical reads (`battles_trends`, `cards_card`, `clans_standings`, `war_history`) | per call | up to 18 seconds of database time, shortened when the function has less time left | tool error `query_timeout` with a retry hint and `meta.request_id`; no partial aggregation (see [Protocol](/docs/protocol#errors)) |
| Read deadline | every other read-only tool, on MCP, in Explore and on `/api/v1` | per call | the function's remaining time less 1.5 seconds (about 23 seconds on MCP, 17 on the web door); a read waits at most 5 seconds for a lock | the same `query_timeout` (HTTP 503 with `retry_after_s` on `/api/v1`); a write is never raced, so a retry cannot double-apply it |
| Response size | every tool result | per call | 48,000 characters | `result_too_large` "Result is N characters; the cap is 48000.", with a hint naming the arguments that narrow it (see [Protocol](/docs/protocol#the-response-cap)); `live_fetch` refuses a battle-log path with the same code before spending the lane |
| Audit argument size | the call log | per call | 4,000 bytes | arguments are trimmed in the log only; the call is unaffected |

## Reading your balance

`meta.quota` rides every tool result that has a meta envelope:

```json
"quota": { "calls": { "used": 41, "max": 500, "remaining": 459 },
           "live":  { "used": 2, "max": 20, "remaining": 18 },
           "resets_at": "{{ build.nextResetAt }}" }
```

`max` and `remaining` are `null` when unlimited. Collector credits are already
in `calls.max`. The balance is described after the call, so a live fetch the
call made is already counted. Usage shows the same numbers with the
agents' share broken out.

## What is deliberately unlimited

Reads of recorded game data are bounded only by the daily call quota, never by
tier or by subject. Feedback has no limit of its own. The daily counter fails open:
if the quota store is unreachable, active accounts keep working.

## Retention windows

| Data | Kept |
|---|---|
| Recorded game history, snapshots, war | indefinitely |
| Raw API payloads | archived to S3 at admission; latest per subject stays hot |
| Call log rows | indefinitely: the tool, when, which credential and client, the country it came from, and how the call went; the address (`viewer_ip`) cleared after 30 days; arguments cleared after 90 days |
| Credential refusal counts | 30 days |
| Timeline game-moment ledger | indefinitely; a timeline read covers at most 30 days |
| Captured request and response bodies of tool calls | 90 days (S3 lifecycle expiry; the console stops offering them on the same clock) |
| OAuth tokens | 90 days past expiry (grant life is 90 days) |
| Console sessions | 90 days absolute, 30 days sliding; the address a session was last used from cleared 30 days after that use; rows purged 30 days after expiry |
| Sign-in codes | 15 minutes live; rows purged 30 days after expiry |
| Rate-limit counters | 7 days |
| Integration usage rows | 90 days |
| Integration refresh requests | 24 hours (status returns 404 after) |
| Job ledger | done 7 days, dead 30 days |
| Database backups | about a week, rolling; something cleared above can stay in a backup for a few more days |
