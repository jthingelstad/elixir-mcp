---
slug: limits
title: "Limits"
navTitle: "Limits"
description: "Every quota and rate limit in one table, with the exact refusal each produces: the hourly bucket, daily tool calls, live fetches, slots, agents, OAuth registration, sign-in codes, the collector door and the REST API."
order: 34
section: reference
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
| Tool calls per day | every `tools/call`, billed before the tool runs (a failed call still counts) | `mcpday#<account>` | role `mcp_calls_per_day` + collector credits, capped at 4× base; owner/admin unlimited | JSON-RPC `-32029` over HTTP 200: "Daily tool-call quota reached (N per day). It resets at midnight UTC." No `meta.quota` on this reply. |
| Explorer calls per day | Explore page | same bucket | same | HTTP 429 `{"error":"quota_exceeded","message":"Daily tool-call quota reached (N per day)…"}` |
| Live fetches per day | `live_fetch`, `players_profile` with `live: true`; every agent shares its owner's lane | `liveday#<account>` | role `live_fetches_per_day` or the account override; owner/admin unlimited | tool error `quota_exceeded`: "Live-fetch quota reached (N/day for the <role> tier, shared with your owner's other agents)." |
| Player slots | `elixir_add_player`, `POST /api/claims` | live count | 50 (member to partner), +2 with an active collector; override `max_player_recordings` | MCP: `quota_exceeded` "Added players are capped at N for the <role> tier." Web: HTTP 429 same message |
| Clan slots, activity | `elixir_add_clan`, `POST /api/me/clans` | live count per scope | 1 / 1 / 3 / 10, +1 with an active collector | `not_entitled` "The <role> tier has no activity-scope clan slots" or `quota_exceeded` "Your activity-scope clan slots are full (N for the <role> tier)." Web: HTTP 429 |
| Clan slots, comprehensive | same | same | 0 / 1 / 3 / 5 | same wording with `comprehensive` |
| Collections | `POST /api/me/collections` | live count | 0 / 0 / 5 / 20 | HTTP 403 `not_entitled` "Creating collections needs the family tier or above" or HTTP 429 `quota_exceeded` "The <role> tier can curate up to N collections." |
| Collection members per call | `collections_edit` | per call | 500 tags | `bad_request`; a single malformed tag fails the whole call |
| Agents | `POST /api/me/agents` | live count | 3 / 5 / 10 / 25 | HTTP 400 `{"error":"not_entitled","reason":"agent_limit","limit":N,"role":"…"}` |
| OAuth client registration | `POST /oauth/register` | `dcr#<ip>`, `dcr#global` | 20 per hour per address; 200 per day in total | HTTP 429 `{"error":"temporarily_unavailable"}` |
| OAuth consent emails | `/oauth/authorize` step one | `oauthmail#<ip>` | 10 per hour | silent: the page says "check your email" and no mail is sent |
| Sign-in emails (console) | `POST /api/auth` | `auth#<ip>`, `auth#<email hash>` | 10 per hour per address, 5 per hour per email | silent: HTTP 200 with the usual message |
| Sign-in code attempts | code verification | per pending code | 5, then the code is dead | HTTP 400 `{"error":"invalid_or_expired","reason":"attempts_exhausted"}` (console); the OAuth page says "Too many attempts on that code" |
| Access requests | `POST /api/request-access` | `reqaccess#<ip>` | 5 per hour | HTTP 429 `{"error":"rate_limited"}` |
| Role-upgrade requests | `POST /api/me/role-request` | pending state | one pending at a time | HTTP 409 |
| Feedback | `elixir_feedback`, `POST /api/feedback` | none | message 1 to 4000 chars | never metered beyond the daily call quota |
| Collector door, work | `/api/collector/lease` and `/submit` | `collector-work#<gateway>` | 10,000 per hour | HTTP 429 with `retry-after` and `{"error":"rate_limited","scope":"work","limit_per_hour":10000,"retry_after_s":N,"hint":"…"}` |
| Collector door, config | `/api/collector/config` | `collector-config#<gateway>` | 120 per hour | same shape, `scope: "config"` |
| Collector outstanding leases | `/api/collector/lease` | per gateway | 2 unsubmitted | HTTP 429 `{"error":"lease_cap","hint":"At most 2 unsubmitted leases; submit or wait 90s."}` |
| Collector quarantine | lease expiry | `missed_streak` | 10 expired leases in a row | HTTP 409 `{"error":"quarantined"}`; the collector drains and the owner is notified |
| REST calls per hour | `/api/v1/*` | `rest-hour:<integration>` | per integration, default 2,000 | HTTP 429 problem `rate_limited`, `Retry-After` to the top of the hour |
| REST calls per day | `/api/v1/*` | usage row | per integration, default 10,000 | HTTP 429 problem `daily_quota_exceeded`, `Retry-After` to UTC midnight |
| REST profile refreshes per day | `POST /api/v1/profile-refreshes` | usage row | per integration, default 1,000; an idempotent replay does not spend one | HTTP 429 problem `refresh_quota_exceeded`, `Retry-After: 3600` |
| REST batch size | `POST …/members` | per call | 1 to 500 tags | HTTP 400 problem `invalid_members` |
| REST collection capacity | grant | per grant, default 10,000 | over the limit | HTTP 409 problem `enrollment_limit` |
| Response size | every tool result | per call | 48,000 characters | `bad_request` "Result exceeds 48000 characters." (see [Protocol](/docs/protocol#the-response-cap)) |
| Audit argument size | the call log | per call | 4,000 bytes | arguments are trimmed in the log only; the call is unaffected |

## Reading your balance

`meta.quota` rides every tool result that has a meta envelope:

```json
"quota": { "calls": { "used": 41, "max": 500, "remaining": 459 },
           "live":  { "used": 2, "max": 20, "remaining": 18 },
           "resets_at": "2026-09-10T00:00:00.000Z" }
```

`max` and `remaining` are `null` when unlimited. Collector credits are already
in `calls.max`. The balance is described after the call, so a live fetch the
call made is already counted. Account → Usage shows the same numbers with the
agents' share broken out.

## What is deliberately unlimited

Reads of recorded game data are bounded only by the daily call quota, never by
tier or by subject. Feedback is never metered. The daily counter fails open:
if the quota store is unreachable, approved accounts keep working.

## Retention windows

| Data | Kept |
|---|---|
| Recorded game history, snapshots, war | indefinitely |
| Raw API payloads | archived to S3 at admission; latest per subject stays hot |
| Call log rows | indefinitely; `viewer_ip` cleared after 30 days; arguments cleared after 90 days |
| Credential refusal counts | 30 days |
| Event feed rows | 30 days |
| OAuth tokens | 90 days past expiry (grant life is 90 days) |
| Console sessions | 90 days absolute, 9 days sliding; rows purged 30 days after |
| Sign-in codes | 15 minutes live; rows purged 30 days after expiry |
| Rate-limit counters | 7 days |
| Integration usage rows | 90 days |
| Integration refresh requests | 24 hours (status returns 404 after) |
| Job ledger | done 7 days, dead 30 days |
