---
slug: integrations
title: "Integrations"
description: "The REST API for platforms: admin-issued credentials, recorded profiles, asynchronous refreshes, a game clock, and automatic collection enrollment."
section: record
order: 24
navTitle: "Integrations"
icon: share-2
lede: "First-party services reading the hub with a service key."
---

# Integrations

An integration connects a platform to Elixir. It has no personal player, clan
identity, or human admin powers. [Elixir Drop](https://drop.poapkings.com) is the
first consumer: it reads game context and automatically enrolls supplied player
tags for recording. Drop keeps its accounts, scores, XP and badges in Drop.

People and clan agents use MCP. Integrations use **REST at
`https://elixir.poapkings.com/api/v1`**. These routes share the recorder and its
collector job ledger; they do not call MCP tools over HTTP. The
[OpenAPI contract](/docs/integration-api.json) describes the wire format.

## Provisioning and administration

**Admin → Integrations** creates the platform identity, issues a key, sets API
and refresh budgets, and grants addition rights to existing player collections.
Admins can change permissions, revoke or rotate keys, and suspend or resume an
integration. The screen shows last key use, daily usage, recording depth, member
counts and enrollment limits. Collection depth and ownership remain controlled
by the collection's administrator. Removing a grant does not remove members.

The raw `svt_…` key appears once; only its SHA-256 digest is stored. Keep it in
the consuming platform's server configuration. Never ship it to a browser.
Send `Authorization: Bearer <key>` on every request. Cookie sessions, personal
MCP tokens, agent tokens and OAuth tokens do not authenticate here. A REST key
cannot authenticate to MCP. Legacy MCP integrations remain compatible during
migration; no new integration should use that transport.

Rotation immediately revokes the previous key. Suspension refuses all keys;
resumption restores an unrevoked key. Quotas and grants belong to the integration,
so rotation neither resets usage nor multiplies capacity. The human sponsor is
accountable for the integration but contributes no admin authority or quota.

## Resources and permissions

| Method and path | Permission | Result |
| --- | --- | --- |
| `GET /game/clock` | `game:read` | Game calendar with absolute season and day boundaries |
| `GET /players/{tag}` | `players:read` | Recorded name, clan, account age and source timestamp |
| `POST /profile-refreshes` | `profiles:refresh` | Accepted asynchronous profile refresh |
| `GET /profile-refreshes/{id}` | `profiles:refresh` | Pending, complete or failed refresh |
| `PUT /collections/{id}/members/{tag}` | `collections:members:add` plus collection grant | Idempotent addition and recording enrollment |
| `POST /collections/{id}/members` | Same | Bounded add-only batch |

Tags must be URL-encoded in paths: `#2PYQ0` becomes `%232PYQ0`. Collection IDs
are decimal identifiers; a collection's slug is also accepted. A grant is for a
specific existing collection, not every collection owned by the sponsoring human.

Successful responses contain `data` and `request_id`. Failures use
`application/problem+json`, with `type`, `title`, `status`, `code`, `detail` and
`request_id`. The `X-Request-ID` response header ties either response to the
operational audit. Treat unknown response fields as additions compatible with v1.

## The game clock is policy

`GET /game/clock` reports `source: "policy"`, `as_of`, `season_id`,
`season_started_at`, `season_ends_at`, `week`, `section_index`,
`period_index`, `day_kind` (`training` or `war`), `war_day` (integer or
`null`), `day_started_at`, `day_ends_at` and `notes` (strings). Its calendar is the
same calculation as MCP's `game_clock`: days and seasons roll at **10:00 UTC**;
seasons span first Monday to first Monday. It does not borrow a clan's observed
river-race opening. `as_of` dates the calculation, not a collector observation.

Consumers should use the supplied boundaries. Drop retains its FIFO rule:
finalize the previous season successfully before caching the new clock. Existing
results keep their assigned seasons. During an outage a cached policy clock must
not carry the old season beyond its explicit end.

## Profiles and asynchronous refreshes

`GET /players/{tag}` performs no live fetch. `observed_at` is the recorder's
source timestamp, not the time the response was delivered. A known tag without a
profile observation returns `404 not_recorded`. Names, clan and account age can
be incomplete; null means unknown, not zero. Recording enrollment is not itself
an observation.

When a profile is missing or too old for your product, send:

```http
POST /api/v1/profile-refreshes
Authorization: Bearer <key>
Content-Type: application/json
Idempotency-Key: <stable-operation-key>

{"player_tag":"#2PYQ0"}
```

The `202` response includes an opaque refresh `id`, `status`, `created_at` and
`expires_at`, plus a `Location` status URL and `Retry-After: 5`. Retry the same
operation with the same key. Reusing a key for a different tag is a conflict.
Collectors execute the request through the existing live lane and global CR
budget. An active live job for the same tag can be shared.

Poll the status URL at or after `Retry-After`. A refresh is readable only by its
integration; rotating the credential preserves access. `complete` includes a
recorded `profile` and requires an admitted collector result and projected
profile data. A job being marked done is insufficient. Rejection, dead work or a
15-minute timeout yields `failed` with `refresh_unavailable`. Use a new operation
key to retry a failed refresh. Requests expire after 24 hours, after which their
status returns 404. A one-time refresh does not create a recording subscription.

## Automatic collection membership

A platform may automatically add a supplied tag to its granted collection. Drop
asserts membership on login and when a player saves an optional CR tag, through
its durable refresh queue. Failed enrollment retries there; queue submission or
hub outages must not fail login or profile save. The add-only reconciliation
script repairs older or missed additions.

A single addition uses `PUT` with an empty JSON object. A batch uses `POST` with
`{"tags":["#2PYQ0"]}` and accepts 1–500 tags. The response includes `added`,
`already_present`, `total`, `recordings_started` and `enrollment_established`.
The latter confirms the recording reason exists, not that capture has finished.

Membership and recording enrollment commit together. Repeated additions preserve
manual members and are safe to retry. The member limit is checked under the
collection lock, so an oversized batch fails atomically. Recording is shared
with any other accounts or collections already following the subject.

V1 is add-only. Removing a tag from Drop or changing it does not remove its old
collection membership. Integrations cannot replace membership, delete members,
change recording depth, create collections, or upload game facts. A supplied tag
is **unverified** and does not prove identity or participation in the platform.
Only normal collector admission establishes canonical game observations.

## Limits and errors

Admins size each integration independently: API calls per UTC day (default
10,000), API calls per hour (default 2,000), profile-refresh requests per UTC
day (default 1,000), and collection member capacity per grant (default
10,000). `Retry-After` is the seconds to the top of the hour, to UTC midnight,
or 3600 for a refresh refusal.
Refresh retries with the same idempotency key do not spend another refresh unit.
These allowances do not increase the collector fleet's shared upstream budget.

| Status | Meaning |
| --- | --- |
| 400 | `invalid_json` (checked before authentication; send `{}` on GET), `invalid_tag`, `invalid_members`, `idempotency_key_required`, or `bad_request` for a badly percent-encoded path |
| 401 | Missing, wrong-purpose, revoked or suspended credential |
| 403 | Missing permission |
| 404 | Unknown or inaccessible resource; `not_recorded` for missing profile data |
| 409 | `enrollment_limit` or `idempotency_conflict` |
| 429 | `rate_limited`, `daily_quota_exceeded` or `refresh_quota_exceeded` |
| 503 | `temporarily_unavailable` |

Every request with a resolved key is logged with `surface: rest`, the
operation name, duration, size, HTTP status and error code, never the
arguments; usage rows are kept 90 days.

Honor `Retry-After` for throttling and temporary failures. Preserve useful cached
data and retry through background work. Do not turn authentication failures or
quota refusals into extra live fetches.
