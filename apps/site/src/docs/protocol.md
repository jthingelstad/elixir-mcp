---
slug: protocol
title: "Protocol reference"
navTitle: "Protocol"
description: "The wire contract for the MCP door: transport, OAuth discovery and registration, scopes, per-principal URLs, error codes, the response cap, versioning and the tools/list cache-buster, cursors, and the meta envelope."
order: 29
section: reference
---

# Protocol reference

Everything a client author needs to connect without reading the source. The
tool surface itself is on [Tools](/docs/tools) (generated from the registry);
quotas and rate limits are on [Limits](/docs/limits); the response envelope is
on [Reading a response](/docs/responses).

## Transport

| Property | Value |
|---|---|
| Endpoint (personal) | `POST https://elixir.poapkings.com/mcp` |
| Endpoint (agent) | `POST https://elixir.poapkings.com/a/<public_id>/mcp` |
| Endpoint (integration, legacy) | `POST https://elixir.poapkings.com/i/<public_id>/mcp`; integrations use the [REST API](/docs/integrations) |
| MCP protocol versions | `2025-06-18` (default), `2025-03-26` accepted |
| Framing | Streamable HTTP, JSON only. One JSON-RPC message per POST. Every reply is `content-type: application/json`. |
| SSE | Not used. No `text/event-stream`, no server-initiated messages. |
| Sessions | None. No `Mcp-Session-Id` header is issued or required; every request stands alone. |
| Batches | Refused: a JSON array body answers HTTP 400 with JSON-RPC `-32600` "Batched requests are not supported." |
| Notifications | A message without `id` answers HTTP 202 with an empty body. |
| Any non-POST | HTTP 405 with `allow: POST` and an empty body. This includes `GET /mcp`. |
| Malformed JSON (after auth) | HTTP 400 `{"error":"invalid_json"}` |
| CORS | No `Access-Control-*` headers and no `OPTIONS` handling. Browser-resident clients need a proxy. |
| Capabilities declared | `tools: { listChanged: true }` only. No resources, prompts, or logging. |

`public_id` is 8 to 16 characters of `[a-z0-9]`.

## Authentication

Bearer only. Cookies never reach the door.

| Credential | Shape | Where it works |
|---|---|---|
| OAuth access token | opaque, `eat_` + 43 base64url chars | the resource it was issued for |
| Service token (agent key) | `svt_` + 43 base64url chars | the agent's own URL |
| Integration key | `svt_…` with audience `integration_api` | `/api/v1` only; refused at every MCP door |

Refusals:

| Case | Status | Body | Header |
|---|---|---|---|
| No `Authorization: Bearer` | 401 | `{"error":"invalid_token"}` | `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource[<door path>]", scope="cr:read"` |
| Unknown, expired, revoked, or suspended credential | 401 | same | same |
| Valid credential at the wrong door | 403 | `{"error":"wrong_resource","message":"This credential is not for <resource>.","hint":"…"}` | none |
| Tool needs a scope the token lacks | 403 | JSON-RPC error `-32003` (below) | `WWW-Authenticate: Bearer error="insufficient_scope", scope="<granted + required>", resource_metadata="…"` |

Every refused credential is counted (per credential, per source address, per
day) and shown to the owner on Account → Connections or the agent's page, so a
runtime still presenting a revoked key is visible even though it never reaches
the call log.

## OAuth 2.1

### Discovery

`GET https://elixir.poapkings.com/.well-known/oauth-authorization-server`

```json
{
  "issuer": "https://elixir.poapkings.com",
  "authorization_endpoint": "https://elixir.poapkings.com/oauth/authorize",
  "token_endpoint": "https://elixir.poapkings.com/oauth/token",
  "registration_endpoint": "https://elixir.poapkings.com/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["cr:read", "recordings:write", "collections:write", "account:write", "feedback:write"]
}
```

`GET https://elixir.poapkings.com/.well-known/oauth-protected-resource` (and
`…/oauth-protected-resource/a/<public_id>/mcp` for an agent door):

```json
{
  "resource": "https://elixir.poapkings.com/mcp",
  "authorization_servers": ["https://elixir.poapkings.com"],
  "scopes_supported": ["cr:read"],
  "bearer_methods_supported": ["header"]
}
```

The protected-resource document lists only `cr:read` on purpose: the write
scopes are granted by step-up, not discovery. **A client that never steps up is
not a dead end.** The consent page lists every capability the request did not
ask for as an unticked checkbox, and what you tick is added to the grant, so a
person can allow `feedback:write` to a client that only ever requests
`cr:read`. The token response reports the scope actually granted (RFC 6749
§3.3), which is how the client learns it holds more than it asked for. Both
documents are cacheable for 300 seconds. There is no revocation or introspection endpoint; a person
revokes a connection on Account → Connections.

### Dynamic client registration

`POST /oauth/register`, no authentication.

| Field | Rule |
|---|---|
| `redirect_uris` | required; 1 to 5 entries; `https:` on any host, or `http:` on `localhost`, `127.0.0.1`, `[::1]`; no fragment or userinfo; max 2048 chars; duplicates collapse |
| `client_name` | optional; control characters and `<>&"'` stripped, truncated to 100; empty becomes `MCP client` |
| anything else | ignored |

Responses: 201 with `client_id` (24 chars base64url), `client_name`,
`redirect_uris`, `token_endpoint_auth_method: "none"`, `grant_types`,
`response_types`; 400 `invalid_client_metadata` or `invalid_redirect_uri`;
429 `temporarily_unavailable` past 20 registrations an hour from one address
or 200 a day in total. Clients are public (no secret). A registration lives 365
days from its last use.

### Authorization

`GET /oauth/authorize` renders the sign-in page; parameters are validated on
GET and POST:

| Parameter | Rule | Failure |
|---|---|---|
| `client_id` | registered and unexpired | `unknown client_id` |
| `redirect_uri` | one of the registered URIs | `redirect_uri not registered` |
| `code_challenge` | required, 43 to 128 chars of `[A-Za-z0-9_-]` | `invalid code_challenge` |
| `code_challenge_method` | `S256` (default); nothing else | `code_challenge_method must be S256` |
| `scope` | space-separated; must include `cr:read`; unknown scopes refused; empty means `cr:read` | `invalid_scope` |
| `resource` | **required**: the exact door URL the token is for (`https://elixir.poapkings.com/mcp` for a person) | `invalid_target` |
| `state` | optional; over 512 chars is silently replaced by empty | – |

PKCE is not optional. `resource` follows RFC 8707 and must be repeated at the
token endpoint with the same value; the token is bound to that door.

Failures render an HTML page at the authorize URL. Nothing is ever sent back to
`redirect_uri` as `error`; a client waiting only on its callback should also
time out.

Consent is a two-step page: the person enters their account email and receives
a six-digit code (15-minute life, five attempts, single use, valid only for
this flow), then enters the code beside a list of the capabilities the client
asked for. Success redirects with HTTP 303 to `redirect_uri` carrying `code`,
`state` (if given) and `iss`. Authorization codes are `eac_…`, single use, 300
seconds.

For an agent door (`/a/<public_id>/mcp`), only the agent's owner may consent,
and the resulting grant is for the agent, not the person. An agent that does
not exist and an agent you do not own get the same refusal.

### Tokens

`POST /oauth/token`, form-encoded, no client authentication.

| Grant | Required fields | Errors |
|---|---|---|
| `authorization_code` | `grant_type`, `client_id`, `code`, `code_verifier`, `redirect_uri`, `resource` | 400 `invalid_grant` (used, expired, wrong client, wrong redirect, PKCE mismatch), 400 `invalid_target` (resource differs from the code's) |
| `refresh_token` | `grant_type`, `client_id`, `refresh_token`, `resource` | 400 `invalid_grant`, 400 `invalid_target` |
| other | – | 400 `unsupported_grant_type` |

Success: `{ "access_token", "refresh_token", "token_type": "Bearer", "expires_in": 3600, "scope" }`.

| Lifetime | Value |
|---|---|
| Access token | 1 hour |
| Refresh token | 30 days; every refresh returns a new pair |
| Grant (family) | 90 days from consent, then re-consent |

Presenting a refresh token that has already been rotated revokes the whole
grant. Refreshing never widens scope.

### Scopes

| Scope | Grants | Tools that need it |
|---|---|---|
| `cr:read` | every read tool, `live_fetch`, and `elixir_events` (advancing your cursor is a bookmark, not an account change) | all others |
| `recordings:write` | add or remove players and clans | `elixir_add_player`, `elixir_add_clan` |
| `collections:write` | edit collections you own | `collections_edit` |
| `account:write` | private nicknames and end-user identity mappings | `elixir_nickname`, `elixir_identify` |
| `feedback:write` | file attributed feedback | `elixir_feedback` |

Canonical order is the order above. A call to a tool outside the token's
scope answers HTTP 403 with the `insufficient_scope` challenge and this body:

```json
{ "jsonrpc": "2.0", "id": 7,
  "error": { "code": -32003,
    "message": "The access token lacks the capability required by this tool: recordings:write.",
    "data": { "required_scope": "recordings:write", "granted_scope": "cr:read",
              "hint": "Reconnect this client and grant 'recordings:write' on the consent page (the first connection grants only cr:read). Owner-issued service tokens carry every capability. Read tools, including elixir_events, need only cr:read." } } }
```

The challenge's `scope` is the granted set plus the missing one, so a client
can re-authorize with exactly that value.

If your client does not implement that step-up - several do not, and some
render the 403 as an expired credential - you have two ways in, neither of
which needs the client to cooperate:

- **At consent:** reconnect and tick the missing capability on the consent
  page, which offers every scope the request left out.
- **After the fact:** Account -> Connections lists every live OAuth
  connection with its capabilities and lets you change them. This covers the
  personal door and every agent or integration door you own, each of which
  carries its own grant. An agent can also connect with its **service key**
  rather than OAuth, and a key's capabilities are not part of any grant - edit
  those on the agent's own page (Account -> Agents). Editing takes effect on that connection's next call - no reconnect,
  because the token's scope is read from the grant on every request. Narrowing
  works the same way, so a capability can be taken back without disconnecting
  the client.

Either way the grant is yours; the client cannot ask on your behalf. Service
tokens issued with no scope carry every capability.

## Principals and what each sees

`initialize` returns the same shape for every door; `kind` decides the tool
list.

| Kind | Door | Hidden tools | Tools listed |
|---|---|---|---|
| `person` | `/mcp` | none | 44 |
| `agent` | `/a/<public_id>/mcp` | `elixir_my_players`, `elixir_add_player`, `elixir_add_clan` | 41 |
| `integration` | `/i/<public_id>/mcp` | the three above plus `elixir_nickname`, `elixir_events` | 39 |

Hiding is enforced: calling a hidden tool answers JSON-RPC `-32601` with
`data.kind` and a hint. Do not rely on a cached `tools/list` from another kind
of connection.

## `initialize`

```json
{ "protocolVersion": "2025-06-18",
  "capabilities": { "tools": { "listChanged": true } },
  "serverInfo": { "name": "elixir-mcp", "title": "Elixir MCP - Clash Royale history, recorded",
                  "version": "0.39.2+tools.3f1c9a2b7d4e", "websiteUrl": "https://elixir.poapkings.com/" },
  "instructions": "…",
  "_meta": { "elixir.poapkings.com/principal": { "kind": "person",
             "subject": { "type": "player", "tag": "#20JJJ2CCRU", "name": "King Thing" },
             "clan": { "tag": "#J2RGCRVG", "name": "POAP KINGS" } } } }
```

`instructions` is prose tuned for the model (it names your primary, alts,
friends and clan, or the clan an agent acts for) and changes without notice;
never parse it. The same facts ride in `_meta` as data; see
[Reading a response](/docs/responses#knowing-who-you-are-connected-as).

## Versioning and the cache-buster

`serverInfo.version` is `<contract_version>+tools.<fingerprint>`, where the
fingerprint is the first 12 hex characters of the SHA-256 of the declarations
your kind of connection receives. The server is stateless and never sends
`notifications/tools/list_changed` even though it declares `listChanged`;
compare `serverInfo.version` on every `initialize` and re-read `tools/list`
when it differs. `elixir_changelog({ since: "0.35.0" })` lists what moved,
newest first, with `tools_added` and `breaking` where relevant.

The contract is semver over the tool surface, not the code: additive is a
minor, breaking is a major with a deprecation window. Every response carries
`meta.contract_version`.

## Errors

Three layers, each with a closed set.

**HTTP**: 401, 403, 405, 429 as above; 400 for malformed JSON or a batch; 500
never carries internals.

**JSON-RPC** (`error.code`):

| Code | When | HTTP |
|---|---|---|
| `-32600` | not a JSON-RPC 2.0 object, or a batch | 400 |
| `-32601` | unknown method, or a tool hidden from this principal kind | 200 |
| `-32602` | unknown tool name | 200 |
| `-32029` | daily tool-call quota reached; message names the cap and "It resets at midnight UTC." | 200 |
| `-32003` | insufficient scope | 403 |

**Tool result**: a failed call is a normal `tools/call` result with
`isError: true` whose `content[0].text` is JSON:

```json
{ "error": { "code": "not_recorded", "message": "…", "hint": "…" },
  "meta": { "as_of": "…", "request_id": "…", "disclaimer": "…", "contract_version": "0.39.2" } }
```

| Code | Meaning |
|---|---|
| `invalid_tag` | input failed tag normalisation; hint states the rule |
| `not_entitled` | the caller lacks entitlement to the subject (clan tools, slots, identity binding) |
| `not_recorded` | the subject is valid but nothing has been recorded for it |
| `not_found` | unknown to the record and to the live API; also "no default player" cases |
| `quota_exceeded` | a per-account slot or live-fetch cap; the daily call quota uses `-32029` instead |
| `live_unavailable` | the live lane timed out, has no collector, or the payload was refused at admission |
| `bad_request` | structurally invalid input other than tags: unknown enum, inverted window, over-max limit, bad cursor, oversized result |

Check the error body, not only the transport flag. `hint` says what would fix
the call; `meta.request_id` identifies it for a report.

## The response cap

A result over **48,000 characters** of compact JSON is not delivered sliced.
The body is replaced by a `bad_request` error, "Result exceeds 48000
characters.", with a hint naming the tool's narrowing arguments (or, for a
tool without any, asking you to report the `request_id`). The original
`request_id` is preserved and `isError` is set. `battles_query` refuses
`limit` above 25 unless `verbosity: "compact"` for this reason.

## Argument conventions

- **Tags.** `#` plus 3 to 12 characters from `0289PYLQGRJCUV`. Input is
  trimmed and upper-cased, a missing `#` is added, and the letter O folds to
  zero. Anything else is `invalid_tag`.
- **Omit `player_tag` to mean the caller**: your primary player on a personal
  connection, or whoever `on_behalf_of` maps to on an agent. An empty string
  is refused as a caller bug, never treated as "default".
- **`on_behalf_of`** (≤200 chars, opaque) selects the end user on an agent
  connection; ignored on a personal one. See [Agents](/docs/agents).
- **Omit `clan_tag`** to mean your recorded clan (a person's first added clan,
  an agent's clan).
- **Validation is strict** since 0.39.2: arguments are checked against the
  published `inputSchema` before the handler runs. An unknown enum value, an
  inverted date window, or a `limit` above the declared maximum is
  `bad_request`, never clamped or emptied.
- **Dates** accept an ISO instant or `YYYY-MM-DD`; a date-only value resolves
  in the account's timezone. Meta-style tools default `from` to 28 days ago.
- **Timestamps** in responses are ISO 8601 UTC with a trailing `Z`.
  `meta.timezone_applied` names the display zone when local labels were used.
- **Null is unknown, never zero**: a source never polled has `observed_at:
  null` and `freshness_seconds: null`; an unknown war attendance is `null`; a
  destroyed tower is `0` and unreported tower data is `null`.
- **Cursors.** `battles_query` returns an opaque `next_cursor` (`null` means
  the end; a forged or stale cursor is `bad_request`) and echoes
  `limit_applied`. `elixir_events` uses an integer `since` by `event_id`.
- **Verbosity.** Only `battles_query` has `verbosity: full | compact`;
  `compact` drops per-card decks and `tower_hp` but keeps `deck_hash`.

## Identifiers the record uses

- **`deck_hash`**: SHA-256 hex of `sort(cards.map(c => id + ":" + (evolutionLevel ?? 0))).join(",") + "|" + (towerTroopId ?? 0)`.
  Card form (`evolutionLevel` 1 = Evolution, 2 = Hero, absent or 0 = base)
  is part of identity; card levels and star levels are not.
- **`battle_id`**: SHA-256 of the canonical battle time, the sorted
  participant tags, and the battle class; the same battle seen from two
  logs is one row.
- **`request_id`**: a UUID minted before the tool runs and stamped into
  `meta`; the same id appears on Account → Activity.

## Feedback and the changelog, over the wire

- `elixir_feedback({ message, category?, context? })`: `message` 1 to 4000
  chars; `category` one of `general` (default), `bug`, `data_quality`,
  `feature`, `praise`, `other`. Never metered.
- `elixir_my_feedback({ limit?, status?, since? })`: `status` one of `new`,
  `seen`, `planned`, `done`, `declined`; returns `response`, `responded_at`,
  `shipped_in`, `related_tools`. Reading it clears
  `meta.feedback_responses_pending`.
- `elixir_changelog({ since? })`: entries `{ version, date, summary,
  tools_added?, breaking? }`, newest first.

## Machine-readable surfaces

| URL | Contents |
|---|---|
| `/llms.txt` | this site in one page: docs index, tool list, endpoint |
| `/llms-full.txt` | every documentation page and the full tool reference in one fetch |
| `/tools.json` | the registry as JSON: name, group, description, arguments, required scope |
| `/docs/integration-api.json` | the REST API's OpenAPI 3.1 document |
| `/data/changelog` | the contract changelog, the same list `elixir_changelog` returns |
| `/feed.xml` | RSS 2.0 of What's new |
| `/api/public/stats`, `/api/public/status` | live corpus totals and recording health, no authentication |
