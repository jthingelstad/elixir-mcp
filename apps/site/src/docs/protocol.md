---
slug: protocol
title: "Protocol reference"
description: "The wire contract for the MCP door: transport, OAuth discovery and registration, scopes, per-principal URLs, error codes, the response cap, versioning and the tools/list cache-buster, cursors, and the meta envelope."
section: using
order: 10
navTitle: "Protocol"
icon: network
lede: "The MCP surface: transport, sessions, errors and versioning."
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
| Capabilities declared | `tools: { listChanged: true }`, `resources: { subscribe: false, listChanged: false }`, `prompts: { listChanged: false }`. No logging. Every `tools/call` result carries the same JSON as `structuredContent` beside the text block. |

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
| No `Authorization: Bearer` | 401 | `{"error":"invalid_token"}` | `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource[<door path>]", scope="cr:read recordings:write collections:write account:write feedback:write"` |
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
  "scopes_supported": ["cr:read", "recordings:write", "collections:write", "account:write", "feedback:write"],
  "bearer_methods_supported": ["header"]
}
```

Both documents advertise all five capabilities, and so does the 401
challenge's `scope`. **A client that names no scope in particular is offered
every capability, ticked, on the consent page**, where the person can untick
any of them (since 1.0.0; before it the default was `cr:read` alone, which
refused the feedback every agent is told to file on its own judgment). A
client that asks for less is offered the rest as unticked checkboxes, and what
you tick is added to the grant, so a person can allow `feedback:write` to a
client that only ever requests `cr:read`. The token response reports the scope
actually granted (RFC 6749 §3.3), which is how the client learns it holds more
than it asked for. Both documents are cacheable for 300 seconds. There is no revocation or introspection endpoint; a person
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
| `scope` | space-separated; must include `cr:read`; unknown scopes refused; empty or absent means every capability, offered ticked at consent | `invalid_scope` |
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
| `recordings:write` | track or stop tracking players and clans | `elixir_track_player`, `elixir_track_clan` |
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
              "hint": "Reconnect this client and keep 'recordings:write' ticked on the consent page (every capability is offered, ticked, unless the client asked for less), or edit the connection's capabilities under Account -> Connections, which takes effect on the next call. Owner-issued service tokens carry every capability. Read tools, including elixir_events, need only cr:read." } } }
```

The challenge's `scope` is the granted set plus the missing one, so a client
can re-authorize with exactly that value.

If your client does not implement that step-up - several do not, and some
render the 403 as an expired credential - you have two ways in, neither of
which needs the client to cooperate:

- **At consent:** reconnect and keep the capability ticked on the consent
  page, which offers every scope, ticked unless the client asked for less.
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
| `person` | `/mcp` | none | {{ tools.count }} |
| `agent` | `/a/<public_id>/mcp` | `elixir_my_players`, `elixir_track_player`, `elixir_track_clan` | {{ tools.agentCount }} |
| `integration` | `/i/<public_id>/mcp` | the three above plus `elixir_nickname`, `elixir_events` | {{ tools.integrationCount }} |

The counts are generated from the registry at build time. Hiding is
enforced: calling a hidden tool answers JSON-RPC `-32601` with `data.kind`
and a hint. Do not rely on a cached `tools/list` from another kind of
connection.

Tools are declared in group order, then by title, so a client that keeps
server order shows the domain: **Account** (what you track and who you know),
**Players**, **Battles**, **Cards**, **Clans**, **War**, **Collections**,
**Live** (the one raw lane), **Feed** (the push lane), **Service** (the fleet
and the corpus) and **Help** (the documentation, examples, updates, changelog
and the feedback loop). The group rides each tool's title
(`Players · Player profile`); names never carry it, so regrouping breaks
nothing. One page per group is under [Tools](/docs/tools).

## `initialize`

```json
{ "protocolVersion": "2025-06-18",
  "capabilities": { "tools": { "listChanged": true },
                    "resources": { "subscribe": false, "listChanged": false },
                    "prompts": { "listChanged": false } },
  "serverInfo": { "name": "elixir-mcp", "title": "Elixir MCP - Clash Royale history, recorded",
                  "version": "{{ tools.contractVersion }}+tools.3f1c9a2b7d4e", "websiteUrl": "https://elixir.poapkings.com/" },
  "instructions": "…",
  "_meta": { "elixir.poapkings.com/principal": { "kind": "person",
             "subject": { "type": "player", "tag": "#20JJJ2CCRU", "name": "King Thing" },
             "clan": { "tag": "#J2RGCRVG", "name": "POAP KINGS" } } } }
```

`instructions` is prose tuned for the model (it names your primary, alts,
friends and clan, or the clan an agent acts for, then states the argument
conventions below once, then where to start) and changes without notice;
never parse it. The same facts ride in `_meta` as data; see
[Reading a response](/docs/responses#knowing-who-you-are-connected-as).

Resources and prompts are declared beside tools since 1.0.0, because a
stateless server cannot push `notifications/tools/list_changed` and clients
list resources lazily at read time, so the documentation stays reachable when
a cached `tools/list` is stale:

| Method | Returns |
|---|---|
| `resources/list` | `elixir://docs` (the index), `elixir://docs/<slug>` for every page, `elixir://examples`, `elixir://examples/<slug>`, `elixir://changelog`, `elixir://updates`, `elixir://cards` |
| `resources/templates/list` | `elixir://docs/{slug}`, `elixir://docs/{slug}#{section}` (one H2 section), `elixir://examples/{slug}` |
| `resources/read` | Markdown for pages, sections and examples; JSON for the indexes, the changelog, the updates and the card catalog. An unknown URI is JSON-RPC `-32002` |
| `prompts/list`, `prompts/get` | the eleven [examples](/examples/play) as prompts, each a user message carrying the example's question and the tools it uses |

Reading a resource spends no daily quota; the hourly rate limit still applies.

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
| `-32602` | unknown tool name, or unknown prompt | 200 |
| `-32002` | unknown resource URI | 200 |
| `-32029` | daily tool-call quota reached; message names the cap and "It resets at midnight UTC." | 200 |
| `-32003` | insufficient scope | 403 |

**Tool result**: a failed call is a normal `tools/call` result with
`isError: true` whose `content[0].text` is JSON:

```json
{ "error": { "code": "not_recorded", "message": "…", "hint": "…" },
  "meta": { "as_of": "…", "request_id": "…", "disclaimer": "…", "contract_version": "{{ tools.contractVersion }}" } }
```

| Code | Meaning |
|---|---|
| `invalid_tag` | input failed tag normalisation; hint states the rule |
| `not_entitled` | the caller lacks entitlement to the subject (clan tools, slots, identity binding) |
| `not_recorded` | the subject is valid but nothing has been recorded for it |
| `not_found` | unknown to the record and to the live API; an unknown docs page, example or collection |
| `no_subject` | nothing to answer about: no primary player on the account, an `on_behalf_of` nobody has mapped, an agent with no recorded clan. The hint names the one call that fixes it (`elixir_track_player`, `elixir_identify`, or pass the tag) |
| `quota_exceeded` | a per-account slot or live-fetch cap; the daily call quota uses `-32029` instead |
| `live_unavailable` | the live lane timed out, has no collector, or the payload was refused at admission |
| `bad_request` | structurally invalid input other than tags: unknown enum, inverted window, over-max limit, bad cursor, unknown timezone |
| `result_too_large` | the request was fine and the result exceeded the delivery cap; the hint names the narrowing arguments. Also what `live_fetch` answers for a battle-log path, before spending the lane |

Every code is one branch: the message is for a person, the hint names one
executable next step (a tool and its arguments), and an agent should never
have to read the message to know which case it is in. Check the error body,
not only the transport flag; `meta.request_id` identifies the call for a
report.

## The response cap

A result over **48,000 characters** of compact JSON is not delivered sliced.
The body is replaced by a `result_too_large` error, "Result exceeds 48000
characters.", with a hint naming the tool's narrowing arguments and, where
the tool has it, `verbosity: "compact"` (or, for a tool without any, asking
you to report the `request_id`). The original `request_id` is preserved and
`isError` is set. `battles_query` refuses `limit` above 25 unless
`verbosity: "compact"` for this reason, and `live_fetch` refuses a
`/players/{tag}/battlelog` path with the same code before spending a live
fetch, pointing at `battles_query({ live: true })`.

## Argument conventions

The same conventions hold on every tool; the `initialize` instructions state
them once and the per-argument descriptions are one line each. The shorter
version, with the tool map, is [Choosing a tool](/docs/choosing-a-tool).

**What omitting an argument means** depends on the tool's family, and the
first sentence of every description says which:

| Family | Omitted argument | Means |
|---|---|---|
| Player tools (`players_*`, `battles_query`, `battles_performance`, `battles_decks`, `battles_cards`, `battles_opponents`, `battles_levels`, `elixir_coverage`) | `player_tag` | the caller: a person's primary player, or whoever `on_behalf_of` maps to on an agent connection |
| Clan tools (`clans_*`, `war_current`, `war_history`, `war_rivals`) | `clan_tag` | the recorded clan: a person's first tracked clan, an agent's clan |
| Segment tools (`battles_meta_decks`, `battles_meta_cards`, `battles_trends`, `cards_synergy`, `badges_rarity`, `badges_holders`) | the whole `segment` object | the entire recorded corpus |
| `game_clock`, `cards_catalog`, the Help tools | nothing to omit | no subject at all |

No default is ever looked up first, and there is no "no default" guess: a
player tool with nothing to answer about is `no_subject` with the fixing call
in its hint.

- **Tags.** `#` plus 3 to 12 characters from `0289PYLQGRJCUV`. Input is
  trimmed and upper-cased, a missing `#` is added, and the letter O folds to
  zero. Anything else is `invalid_tag`. `*_tag` is one tag, `*_tags` an
  array, `collection` a collection's slug.
- **`on_behalf_of`** (≤200 chars, opaque) selects the end user on an agent
  connection; ignored on a personal one. An empty `player_tag` is refused as
  a caller bug, never treated as "default". See [Agents](/docs/agents).
- **Validation is strict** since 0.39.2: arguments are checked against the
  published `inputSchema` before the handler runs. An unknown enum value, an
  inverted date window, or a `limit` above the declared maximum is
  `bad_request`, never clamped or emptied.
- **Windows** are `from` (inclusive) and `to` (exclusive) on every windowed
  tool: an ISO instant, or `YYYY-MM-DD` resolved in the account's timezone,
  where a date-only `to` covers that whole day. `days` and `weeks` (and
  `seasons` on `war_history`) are sugar for `from`. The per-tool defaults are
  on [Time and clocks](/docs/clocks#windows-and-timezones).
- **`timezone`** on any windowed tool is an IANA zone for that call alone:
  it resolves the date-only bounds and every local label
  (`battle_time_local` is ISO 8601 with its offset). Default: the account's
  timezone. An unknown zone is `bad_request`.
- **`applied`** is the one echo block on every response: `window` (`from`,
  `to`, `source` of `argument` | `default` | `unbounded` | `fixed`,
  `timezone`), `limit`, `sort`, `mode`, `min_battles`, `segment`,
  `verbosity`, as used. There are no `filters_applied`, `window_*` or
  `limit_applied` keys.
- **`verbosity: full | compact`** is the one size control, on
  `battles_query`, `war_current`, `clans_roster`, `battles_levels`,
  `players_collection` and `cards_catalog`; each description says what
  `compact` drops. There is no other flag for size.
- **`notes[]` and `docs`** ride every response: one-sentence caveats to
  repeat, and a `page#section` pointer into this documentation
  (`elixir_docs({ page, section })` or `elixir://docs/<page>#<section>`).
  Formulas live in the docs, never in a note.
- **Timestamps** in responses are ISO 8601 UTC with a trailing `Z`;
  `meta.timezone_applied` names the display zone when local labels were used.
  Events carry `created_at`.
- **Null is unknown, never zero**: a source never polled has `observed_at:
  null` and `freshness_seconds: null`; an unknown war attendance is `null`; a
  destroyed tower is `0` and unreported tower data is `null`.
- **Cursors.** `battles_query` returns `next_cursor` (`null` means the end).
  Treat it as opaque: pass it back unchanged, never parse or construct one; a
  forged or stale cursor is `bad_request`. `elixir_events` uses an integer
  `since` by `event_id`.
- **`live: true`** on `players_profile`, `clans_roster`, `war_current` and
  `battles_query` reads the game first at the cost of one live fetch and
  answers in the usual shape; the four are annotated `openWorldHint`.

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

- `elixir_feedback({ message, category?, context?, request_id? })`: `message`
  1 to 4000 chars; `category` one of `general` (default), `bug`,
  `data_quality`, `feature`, `praise`, `other`. `request_id` is the
  `meta.request_id` of the call the feedback is about — every response
  carries one, and passing it attaches that exact request, its arguments and
  its answer to the report, so the maintainer sees what you saw. `context`
  stays free text for naming a tool or a question. Never metered.
- `elixir_my_feedback({ limit?, status?, since? })`: `status` one of `new`,
  `seen`, `planned`, `done`, `declined`; returns `response`, `responded_at`,
  `shipped_in`, `related_tools`. Reading it clears
  `meta.feedback_responses_pending`.
- `elixir_changelog({ since? })`: entries `{ version, date, summary,
  tools_added?, breaking? }`, newest first.

## Machine-readable surfaces

Over the connection itself, three read-only Help tools serve this
documentation from the same sources the site renders: `elixir_docs` (the
index; one page by slug; one H2 section with `page` + `section`; or a word
search with `query`), `elixir_examples` (the eleven worked examples with the
tools each calls) and `elixir_updates` (What's new, newest first, `since` a
date). The same text is reachable as resources at `elixir://docs`,
`elixir://docs/<slug>`, `elixir://docs/<slug>#<section>`, `elixir://examples`,
`elixir://examples/<slug>`, `elixir://changelog`, `elixir://updates` and
`elixir://cards`, and the examples as prompts. Over plain HTTPS:

| URL | Contents |
|---|---|
| `/llms.txt` | this site in one page: docs index, tool list, endpoint |
| `/llms-full.txt` | every documentation page and the full tool reference in one fetch |
| `/tools.json` | the registry as JSON: name, group, description, arguments, required scope |
| `/docs/integration-api.json` | the REST API's OpenAPI 3.1 document |
| `/updates` | every shipped change, contract versions included - the same list `elixir_changelog` returns, with the releases around it |
| `/feed.xml` | RSS 2.0 of What's new |
| `/api/public/stats`, `/api/public/status` | live corpus totals and recording health, no authentication |
