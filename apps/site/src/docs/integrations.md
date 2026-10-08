---
slug: integrations
title: "Integrations"
description: "The JSON API at /api/v1: people by OAuth, platforms by admin-issued key; recorded profiles, asynchronous refreshes, a game clock, and attested platform facts."
section: build
order: 1
navTitle: "Integrations"
icon: share-2
lede: "First-party services reading the hub with a service key."
---

# Integrations

An integration connects a platform to Elixir. It has no personal player, clan
identity, or human admin powers. [Elixir Drop](https://drop.poapkings.com) is
one: it reads the game clock and recorded profiles, and can refresh a supplied
player's profile. Drop keeps its accounts, scores, XP and badges in Drop.

Agents use MCP. Programs use the **JSON API at
`https://elixir.poapkings.com/api/v1`**, which admits two kinds of caller:

- **An integration**, by its admin-issued key (the rest of this page).
- **A person**, by an OAuth grant whose resource is
  `https://elixir.poapkings.com/api/v1` (scope `cr:read`). This is how a
  family app reads Elixir as the signed-in person; Elixir Drop signs people
  in this way ([Sign in with Elixir](/docs/sign-in-with-elixir)).
  `GET /api/v1/me` returns who you are to Elixir and the players you track,
  and, for a family app whose grant holds `account:email`, your `email` (the
  capability is offered to the family's own apps only; see
  [Signing a person in](/docs/protocol#signing-a-person-in-with-elixir)).
  `POST /api/v1/me/players` tracks a player for the signed-in person, the
  JSON API's `elixir_track_player`, and needs `recordings:write` on the
  grant. A person's read operations answer with the structured result of
  the Elixir tool they mirror, the same fields as its outputSchema on the
  [tools page](/docs/tools), without the agent response cap:
  `GET /clans/{tag}/participation` (`clans_participation`; `weeks` 1 to 8),
  `GET /clans/{tag}/roster` (`clans_roster`),
  `GET /clans/{tag}/war-history` (`war_history`; `seasons` 1 to 12),
  `GET /clans/{tag}/live` (a live clan read), `POST /players/names`, `GET /players/{tag}/profile` and
  `GET /players/{tag}/battles` (`fresh=1` asks for a live read). A
  first-party client, a family app's, is not held to the per-person hourly
  limit; any other client is. A client is first-party when Elixir has
  provisioned it for the family (it is not registered) and its every
  redirect URI is on a family origin; it authenticates at `/oauth/token`
  with `client_secret_post`. A family app
  whose grant holds `clans:attest` records what the person did in their
  clan with `POST /clans/{tag}/facts` (see
  [Attested facts](#attested-facts)).

The two doors keep their credentials apart. An MCP token is refused here, and a
JSON API token is refused at MCP. These routes share the recorder and its
collector job ledger; they do not call MCP tools over HTTP. The
[OpenAPI contract](/docs/integration-api.json) describes the wire format, and
each operation names the callers it admits (`x-principals`).

## Provisioning and administration

**Admin → Integrations** creates the platform identity, issues a key, sets API
and refresh budgets.
Admins can change permissions, revoke or rotate keys, and suspend or resume an
integration. The screen shows last key use, daily usage and refresh usage.

The raw `svt_…` key appears once; only its SHA-256 digest is stored. Keep it in
the consuming platform's server configuration. Never ship it to a browser.
Send `Authorization: Bearer <key>` on every request. Cookie sessions, MCP
tokens and agent keys do not authenticate here; the only other credential
this door takes is a person's OAuth grant for `/api/v1`, above. A REST key
cannot authenticate to MCP. New integrations use this API, not an MCP
integration door.

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
| `GET /clans/{tag}/participation`, `GET /clans/{tag}/roster`, `GET /clans/{tag}/war-history` | `clans:read` | Any recorded clan, answered as a person's grant is (the `clans_participation`, `clans_roster` and `war_history` results): a family app evaluating a clan with nobody signed in, or a clan's website |
| `POST /clans/{tag}/mail` | `mail:send` | A family app's own mail, sent through Elixir by player tag, never by address ([below](#a-family-apps-mail)) |
| `POST /players/{tag}/facts` | `facts:write` | A fact the platform's own game produced for a player ([attested facts](#attested-facts)) |
| `POST /feedback`, `GET /feedback` | `feedback:write` | Feedback to Elixir's maintainer, filed as the integration, and the answers to it (the `elixir_send_feedback` and `elixir_my_feedback` results); [feedback](/docs/protocol#feedback-and-the-changelog-over-the-wire) |

Tags must be URL-encoded in paths: `#2PYQ0` becomes `%232PYQ0`.

Successful responses contain `data` and `request_id`. Failures use
`application/problem+json`, with `type`, `title`, `status`, `code`, `detail` and
`request_id`, plus `hint` (the one next step) and `retry_after_s` (seconds,
beside the `Retry-After` header) when the refusal carries them, as a
person's operation passes on from the tool it mirrors. The `X-Request-ID`
response header ties either response to the operational audit. Treat
unknown response fields as compatible additions.

## Versions

The JSON API carries its own semantic version, the OpenAPI document's
`info.version`; the current version is **3.1.0**. Its callers are programs, so
a removed or renamed response field is a major, and an added field or
operation is a minor. (MCP versions differently: its callers are agents
reading the current declaration.) The path stays `/api/v1` across majors,
because it is also the OAuth audience a person's token is issued for. What
changed in each version is in the OpenAPI document and on
[Updates](/updates).

## Attested facts

Elixir Clan, and a family app through this API, can tell Elixir what a
person did in a clan; an integration can say what its own game produced for
a player. Elixir keeps these **attested facts** apart from the game record, which only collectors write, and
labels each with its source, the person's player, their role, and when. They
are facts with a named source, never Elixir's judgment, and they appear on
the [timeline](/docs/timeline) of the readers their type allows.

| Type | Subject | Who may attest it | Who sees it | Detail |
| --- | --- | --- | --- | --- |
| `departure_classified` | clan, about a member | leader, co-leader | the clan | `kind` (`kick` or `leave`), `left_at` |
| `role_change_made` | clan, about a member | leader, co-leader | the clan | `from`, `to` (`member`, `elder`, `coLeader`, `leader`) |
| `award_granted` | clan, about a member | leader, co-leader, elder | the clan | `award` (60 characters), `season_id`, `place` |
| `member_away` | clan, about a member | leader, co-leader, or the member | the clan's leaders and co-leaders | `until` (an instant, or null) |
| `clan_message` | clan | leader, co-leader, elder (a Clan Leader Message: leaders and co-leaders) | the clan | `channel` (`leader_message` or `clan_chat`), `title` (24), `body` (200) |
| `personal_record` | player | an integration with `facts:write` | whoever has the player on their timeline | `game` (40), `score`, `previous_best` |
| `award_standing` | clan, about a member | the app itself (Elixir Clan, or an integration with `facts:write`) | the clan | `award` (60), `award_id` (40), `season_id`, `place` (1-10), `value`, `unit` (`points`, `donations` or `war_decks`), `as_of`, `previous_player_tag` |

"The clan" is anyone whose verified player is in it today, and an agent
whose owner's player is. A fact for the clan's leaders reaches only a
person whose verified player leads it: never an agent and never mail.
A departure's kind is the clan's: the game already tells the whole clan in clan chat that a member was kicked, and its leaders say why
there.

A clan fact is written by a **person**: in Elixir Clan, or through a family
app (its provisioned client) whose grant holds `clans:attest`, with
`POST /clans/{tag}/facts`. The one exception is what the app itself
computes from its own rules: `award_standing`, where a member stands in one
of the clan's own awards for a season still running (Elixir Clan writes it
each morning). An integration holding `facts:write` writes and takes back
only those types, on the same paths, labelled as the app's and never as a
person's; a person's kinds are refused on its key, and the app's kind on a
person's grant.

```json
{
  "type": "departure_classified",
  "ref": "the app's own id for it",
  "player_tag": "#2PPGY0Q8",
  "occurred_at": "2026-09-25T18:00:00Z",
  "detail": { "kind": "leave" }
}
```

The attester is the person's **verified** player in that clan, with the
role Elixir's roster record holds for it now; a role the type does not
allow is refused (`not_permitted`). `ref` makes a retry the same fact
(`200`, `created: false`) and a new detail for it the attester's newer
word; the first write answers `201`. Replacing a fact needs the right to
the one already there as well as to the one sent (`not_permitted`). `occurred_at` defaults to now and may
be at most an hour ahead or a year behind. `DELETE
/clans/{tag}/facts/{ref}` takes one back, by someone who may attest its
type. A player fact is an integration's, with `POST /players/{tag}/facts`
and the same body; its tag is unverified, as everywhere on this API.

## A family app's mail

A family app can send people its own mail through Elixir, which holds the
address, the switch and the unsubscribe. The one kind is Elixir Clan's
**clan actions waiting** ([Email](/docs/email)), which Clan sends from
inside Elixir under the same rules. `POST /clans/{tag}/mail` names who each
email is for by player tag:

```json
{
  "kind": "clan_actions_waiting",
  "messages": [
    {
      "player_tag": "#2PPGY0Q8",
      "subject": "2 actions waiting for you in Example Clan",
      "lines": ["Promote to Elder: Ada (new)", "Welcome a newcomer: Newbie"],
      "link": "https://elixir.poapkings.com/clan/2PQRJ8LV/actions"
    }
  ]
}
```

Elixir sends a message only to the account whose **verified** claim is
that player, while the player is in the clan, with the kind switched on
(on to start), and at most one of the kind per clan per account per UTC
day. It renders the lines itself, escaped, in its own template (the
unsubscribe, the send id, the disclaimer); the link must lead to a family
app. The answer says what happened to each message (`sent` with its
`send_id`, `already_sent_today`, `no_account`, `not_in_clan`,
`no_address`, `switched_off` or `failed`) and never an address. Up to 50
messages a call.

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
be incomplete; null means unknown, not zero. Tracking a player is not itself
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
budget. An active live job for the same tag can be shared. A new live fetch
spends one request from that budget; when it has none left the request answers
429 `rate_limited` with `Retry-After` set to the next scheduler tick (at most
five minutes), and neither your refresh allowance nor the idempotency key is
spent.

Poll the status URL at or after `Retry-After`. A refresh is readable only by its
integration; rotating the credential preserves access. `complete` includes a
recorded `profile` and requires an admitted collector result and projected
profile data. A job being marked done is insufficient. Rejection, dead work or a
15-minute timeout yields `failed` with `refresh_unavailable`. Use a new operation
key to retry a failed refresh. Requests expire after 24 hours, after which their
status returns 404. A one-time refresh does not create a recording subscription.

## Limits and errors

Admins size each integration independently: API calls per UTC day (default
10,000), API calls per hour (default 2,000), profile-refresh requests per UTC
day (default 1,000). `Retry-After` is the seconds to the top of the hour, to UTC midnight,
3600 for a refresh refusal, or the seconds to the next scheduler tick when
the shared budget is spent.
Refresh retries with the same idempotency key do not spend another refresh unit.
These allowances do not increase the collector fleet's shared upstream budget.

| Status | Meaning |
| --- | --- |
| 400 | `invalid_json` (checked before authentication; send `{}` on GET), `invalid_tag`, `idempotency_key_required`, or `bad_request` for a badly percent-encoded path; on a person's operation also `bad_request` and `result_too_large` from the tool; on a fact write `unknown_fact_type` or `invalid_fact` |
| 401 | `unauthenticated`: missing, wrong-purpose, revoked or suspended credential |
| 403 | Missing permission; `insufficient_scope` when a person's grant lacks the operation's scope; `not_entitled` from a person's tool; on a clan fact `family_apps_only`, `not_in_clan` or `not_permitted` |
| 404 | Unknown or inaccessible resource (`not_found`); `not_recorded` for missing profile data; `no_subject` on a person's operation with nothing to answer about |
| 409 | `idempotency_conflict`; `ref_conflict` when a fact's `ref` already names another type or subject |
| 429 | `rate_limited` (also a refresh when the shared CR budget is spent until the next tick), `daily_quota_exceeded` or `refresh_quota_exceeded`; `quota_exceeded` from a person's tool |
| 500 | `internal`: a fault on Elixir's side that a retry will not fix; no `Retry-After` |
| 502 | `internal` or `live_unavailable` from a person's tool |
| 503 | `temporarily_unavailable` with `Retry-After` when the database is briefly unreachable or a query timed out; on a person's operation `live_pending` or `query_timeout`, with `retry_after_s` |

Every request from a known caller goes in the call log: with `surface:
rest`, the operation name, duration, size, HTTP status and error code,
never the arguments. A person's operation that runs an Elixir tool is
logged as that tool's call instead, the way an MCP call is. Daily usage
counts are kept 90 days; the call log's own windows are on
[Limits](/docs/limits#retention-windows).

Honor `Retry-After` for throttling and temporary failures. Preserve useful cached
data and retry through background work. Do not turn authentication failures or
quota refusals into extra live fetches.
