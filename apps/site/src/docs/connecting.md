---
slug: connecting
title: "Connecting"
description: "The MCP transport, authentication and the OAuth 2.1 flow: discovery, client registration, authorization, tokens, scopes and signing a person in."
section: protocol
order: 1
navTitle: "Connecting"
icon: plug
lede: "The transport, how a client authenticates, and the OAuth 2.1 flow."
---

# Connecting

## Transport

| Property | Value |
|---|---|
| Endpoint (personal) | `POST https://elixir.poapkings.com/mcp` |
| Endpoint (agent) | `POST https://elixir.poapkings.com/a/<public_id>/mcp` |
| Endpoint (integration, legacy) | `POST https://elixir.poapkings.com/i/<public_id>/mcp`; integrations use the [REST API](/docs/integrations) |
| MCP protocol versions | `2025-06-18` (default), `2025-03-26` accepted |
| `MCP-Protocol-Version` header | Checked on every request after `initialize`: absent is taken as `2025-03-26`; a version not listed above is HTTP 400 with JSON-RPC `-32600` and the supported list in `error.data.supported`. Nothing the server sends differs between the two versions. |
| Framing | Streamable HTTP, JSON only. One JSON-RPC message per POST. Every reply is `content-type: application/json`. |
| SSE | Not used. No `text/event-stream`, no server-initiated messages. |
| Sessions | None. No `Mcp-Session-Id` header is issued or required; every request stands alone. |
| Batches | Refused: a JSON array body answers HTTP 400 with JSON-RPC `-32600` "Batched requests are not supported." |
| Notifications | A message without `id` answers HTTP 202 with an empty body, after the credential check. |
| Hourly limit | Counts calls only (`tools/call`, `resources/read`, `prompts/get`); notifications, `initialize`, `ping` and the `*/list` methods are not counted ([Limits](/docs/limits#the-table)). |
| Any non-POST | HTTP 405 with `allow: POST` and an empty body. This includes `GET /mcp`. |
| Malformed JSON (after auth) | HTTP 400 `{"error":"invalid_json"}` |
| CORS | No `Access-Control-*` headers and no `OPTIONS` handling. Browser-resident clients need a proxy. |
| Capabilities declared | `tools: { listChanged: true }`, `resources: { subscribe: false, listChanged: false }`, `prompts: { listChanged: false }`. No logging. Every successful `tools/call` result carries the same JSON as `structuredContent` beside the text block, conforming to the tool's `outputSchema`; a result with `isError: true` carries the text block alone. |

`public_id` is 8 to 16 characters of `[a-z0-9]`.

## Authentication

Bearer only. Cookies never reach the door: `/mcp`, the principal doors,
`/oauth/token` and the discovery documents are served behind a CloudFront
behavior that forwards none. The one exception is the consent page itself,
`/oauth/authorize`, which is a browser page and honours the site session
(below).

| Credential | Shape | Where it works |
|---|---|---|
| OAuth access token | opaque, `eat_` + 43 base64url chars | the resource it was issued for |
| Service token (agent key) | `svt_` + 43 base64url chars | the agent's own URL |
| Integration key | `svt_…` with audience `integration_api` | `/api/v1` only; refused at every MCP door |

Refusals:

| Case | Status | Body | Header |
|---|---|---|---|
| No `Authorization: Bearer` | 401 | `{"error":"invalid_token"}` | `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource[<door path>]", scope="cr:read follows:write account:write feedback:write"` |
| Unknown, expired, revoked, or suspended credential, or an OAuth token at a door it was not issued for | 401 | same | same |
| Valid key (`svt_`) at a door not its own | 403 | `{"error":"wrong_resource","message":"This credential is not for <resource>.","hint":"…"}` | none |
| Tool needs a scope the token lacks | 403 | JSON-RPC error `-32003` (below) | `WWW-Authenticate: Bearer error="insufficient_scope", scope="<granted + required>", resource_metadata="…"` |

Every refused credential that names a real key or account is counted (per
credential, per source address, per day) and shown to the owner on Settings › Connections & agents or the agent's page, so a
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
  "userinfo_endpoint": "https://elixir.poapkings.com/oauth/userinfo",
  "revocation_endpoint": "https://elixir.poapkings.com/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
  "revocation_endpoint_auth_methods_supported": ["none", "client_secret_post"],
  "scopes_supported": ["cr:read", "follows:write", "account:write", "feedback:write", "account:email", "clans:attest"]
}
```

`GET https://elixir.poapkings.com/.well-known/oauth-protected-resource` (and
`…/oauth-protected-resource/a/<public_id>/mcp` for an agent door):

```json
{
  "resource": "https://elixir.poapkings.com/mcp",
  "authorization_servers": ["https://elixir.poapkings.com"],
  "scopes_supported": ["cr:read", "follows:write", "account:write", "feedback:write", "account:email", "clans:attest"],
  "bearer_methods_supported": ["header"]
}
```

Both documents list every capability the server defines. The four
**standard** ones are what the 401 challenge's `scope` advertises and what the
consent page offers; `account:email` and `clans:attest` are the
exceptions, offered only to the family's own apps that name them (described
under [Signing a person in](#signing-a-person-in-with-elixir)). **What a
client asks for is granted; every other standard capability is a checkbox the
person decides on the consent page**, and a client that names no scope asks
for `cr:read` alone. On a person's own connection the checkboxes start
unticked; on an agent or integration every write starts ticked except
`follows:write`, which spends the owner's following slots. Each box
says what the connection cannot do without it, and unticking one that started
ticked asks for confirmation, naming what will not work, before the grant is
made. What you tick is added to the grant, so a person can allow
`feedback:write` to a client that only ever requests `cr:read`. The token response reports the scope
actually granted (RFC 6749 §3.3), which is how the client learns it holds more
than it asked for. Both documents are cacheable for 300 seconds. There is no
introspection endpoint. A person revokes a connection on Settings › Connections & agents; a client revokes its own with [`POST /oauth/revoke`](#revocation).

### Dynamic client registration

`POST /oauth/register`, no authentication.

| Field | Rule |
|---|---|
| `redirect_uris` | required; 1 to 5 entries; `https:` on any host, or `http:` on `localhost`, `127.0.0.1`, `[::1]`; no fragment or userinfo; max 2048 chars; duplicates collapse |
| `redirect_uris` on a family origin | refused: the Elixir family's own apps are provisioned by Elixir, not registered |
| `client_name` | optional; control characters and `<>&"'` stripped, truncated to 100; empty becomes `MCP client`; a name that begins with Elixir's or POAP KINGS' name (ignoring case, spaces and punctuation) is refused |
| anything else | ignored |

Responses: 201 with `client_id` (24 chars base64url), `client_name`,
`redirect_uris`, `token_endpoint_auth_method: "none"`, `grant_types`,
`response_types`; 400 `invalid_client_metadata` or `invalid_redirect_uri`;
429 `temporarily_unavailable` past 20 registrations an hour from one address
or 5,000 a day in total. Registered clients are public (no secret; one sent is
ignored). A registration lives 365 days from its last use. The consent page
shows the client's own name beside the host its codes go to.

A family app's client is provisioned by Elixir and is confidential: it sends
`client_secret` in the form at `/oauth/token` and `/oauth/revoke`
(`client_secret_post`), and a wrong or missing secret is HTTP 401
`{"error":"invalid_client"}`.

### Revocation

`POST /oauth/revoke` (RFC 7009), form-encoded: `token` (an access or refresh
token), `client_id`, and `client_secret` for a family app. Revoking either
token ends the whole grant it belongs to. The answer is HTTP 200 `{}` whether
or not the token was live or the client's own; an unknown client, or a
family app's wrong secret, is HTTP 401 `{"error":"invalid_client"}`.

### Authorization

`GET /oauth/authorize` renders the sign-in page; parameters are validated on
GET and POST:

| Parameter | Rule | Failure |
|---|---|---|
| `client_id` | registered and unexpired | `unknown client_id` |
| `redirect_uri` | one of the registered URIs | `redirect_uri not registered` |
| `code_challenge` | required, 43 to 128 chars of `[A-Za-z0-9_-]` | `invalid code_challenge` |
| `code_challenge_method` | `S256` (default); nothing else | `code_challenge_method must be S256` |
| `scope` | space-separated; must include `cr:read`; unknown scopes refused; empty or absent means `cr:read`, with every other capability offered at consent | `invalid_scope` |
| `resource` | **required**: the exact door URL the token is for (`https://elixir.poapkings.com/mcp` for a person) | `invalid_target` |
| `state` | optional; over 512 chars is silently replaced by empty | – |

PKCE is not optional. `resource` follows RFC 8707 and must be repeated at the
token endpoint with the same value; the token is bound to that door.

Failures render an HTML page at the authorize URL. Nothing is ever sent back to
`redirect_uri` as `error`; a client waiting only on its callback should also
time out.

Consent is a two-step page: the person enters their email and receives
a six-digit code (15-minute life, five attempts, single use, valid only for
this flow), then enters the code beside a list of the capabilities the client
asked for. Success redirects with HTTP 303 to `redirect_uri` carrying `code`,
`state` (if given) and `iss`. Authorization codes are `eac_…`, single use, 300
seconds.

The email step signs in or creates an account, as the website's signup
does: a new address is sent a code, and its ordinary member account opens
only when the code is proved, with the page's **Send me Elixir product
news** box applied to it and the welcome email sent. A denied or disabled
address is sent nothing, and the page is the same for every address. The
email step shares the website's sign-in mail ceilings ([Limits](/docs/limits)).

A browser already signed in to elixir.poapkings.com skips the email and the
code: the page says who it is signed in as, lists the same capabilities, and
one **Authorize** completes the consent. A family app (a provisioned client,
below) signing the person in as themselves has no consent page at all: a
signed-in browser is sent straight back, and the code page lists what the
app gets with no boxes. Either way it is granted exactly the scope it asked
for. `switch=1` on the authorize URL
forces the email step (a shared browser). A client that asks for
`account:email` from an account with no address on file is sent the code way
regardless, because that is where the address is recorded. Consent by code
signs the browser in to the site as well, so the next consent, and the
website, do not ask again. Nothing about the grant differs between the two
paths.

For an agent door (`/a/<public_id>/mcp`), only the agent's owner may consent,
and the resulting grant is for the agent, not the person. An agent that does
not exist and an agent you do not own get the same refusal.

### Tokens

`POST /oauth/token`, form-encoded. A registered client is public and sends no
secret; a family app adds `client_secret` (`client_secret_post`), and a wrong
or missing one is HTTP 401 `{"error":"invalid_client"}`.

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
| Grant | 90 days from consent, then re-consent |

Presenting a refresh token that has already been rotated revokes the whole
grant. Refreshing never widens scope.

### Scopes

| Scope | Grants | Tools that need it |
|---|---|---|
| `cr:read` | every read tool, `live_fetch`, and `elixir_timeline` (moving your read pointer is a bookmark, not an account change) | all others |
| `follows:write` | follow or stop following players and clans | `elixir_follow_player`, `elixir_follow_clan` |
| `account:write` | private nicknames for the players you follow | `elixir_nickname` |
| `feedback:write` | file attributed feedback | `elixir_send_feedback` |
| `account:email` | read the account's email address at `/oauth/userinfo` (and `GET /api/v1/me`); granted only to the Elixir family's own apps | no tool; see below |
| `clans:attest` | nothing at present: no JSON API operation takes it, and a clan's facts are written in Clan; still granted only to the Elixir family's own apps, when they ask for it | no tool |

`recordings:write` is an accepted alias of `follows:write`: a client that
asks for it is granted `follows:write`, and a connection or key that holds
it can follow.

Canonical order is the order above. A call to a tool outside the token's
scope answers HTTP 403 with the `insufficient_scope` challenge and this body:

```json
{ "jsonrpc": "2.0", "id": 7,
  "error": { "code": -32003,
    "message": "The access token lacks the capability required by this tool: follows:write.",
    "data": { "required_scope": "follows:write", "granted_scope": "cr:read",
              "hint": "Reconnect this client and tick 'follows:write' on the consent page (every capability the client did not ask for is offered there), or edit the connection's capabilities under Settings, Connections & agents, which takes effect on the next call. Owner-issued service tokens carry every capability. Read tools, including elixir_timeline, need only cr:read." } } }
```

The challenge's `scope` is the granted set plus the missing one, so a client
can re-authorize with exactly that value.

If your client does not implement that step-up - several do not, and some
render the 403 as an expired credential - you have two ways in, neither of
which needs the client to cooperate:

- **At consent:** reconnect and tick the capability on the consent page,
  which offers every standard scope the client did not ask for.
- **After the fact:** Settings › Connections & agents lists every live OAuth
  connection with its capabilities and lets you change them. This covers the
  personal door and every agent or integration door you own, each of which
  carries its own grant. An agent can also connect with its **service key**
  rather than OAuth, and a key's capabilities are not part of any grant - edit
  those on the agent's Settings page. Editing takes effect on that connection's next call - no reconnect,
  because the token's scope is read from the grant on every request. Narrowing
  works the same way, so a capability can be taken back without disconnecting
  the client.

Either way the grant is yours; the client cannot ask on your behalf. Service
tokens issued with no scope carry every capability.

### Signing a person in with Elixir

A web product in the Elixir family on its own origin (Elixir Drop) can use
Elixir as its sign-in ([Sign in with Elixir](/docs/sign-in-with-elixir)). The
grant it needs is the ordinary one, plus **`account:email`** when it needs the
person's address. Like `clans:attest`, `account:email` is never
offered unasked: it does not appear ticked
on the consent page, is not part of the default grant, is never widened into
from a checkbox or from Settings › Connections & agents, and is not advertised in a 401
challenge. It is offered only to the family's own apps: a client Elixir provisioned,
whose every redirect URI is on a family origin. Any other client that names
it in `scope` is refused `invalid_scope`, so the address is never released
outside the family. A family app signs the person in with no consent page;
one that names it has it listed among what the app gets on the code page,
and the person can end the grant on Settings › Connections & agents.

`GET /oauth/userinfo` with a bearer access token whose grant carries it,
for either personal audience (`/mcp` or `/api/v1`; an agent's is refused):

```json
{ "sub": "<stable account id>", "email": "you@example.com", "email_verified": true, "kind": "person" }
```

`email_verified` is always true: the person proved the address with a code
before any grant existed, and consent records the address on the account.
Refusals: 401 `invalid_token` (no bearer, or not a live personal token for `/mcp` or `/api/v1`),
403 `insufficient_scope` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="account:email"`,
and 404 `email_unavailable` for an account that predates Elixir keeping the
address and whose holder has not signed in since (the next consent fills
it). The answer is never cached. This and `GET /api/v1/me` for a family app
holding the capability (see [Integrations](/docs/integrations)) are the only
places an account's address leaves Elixir.
