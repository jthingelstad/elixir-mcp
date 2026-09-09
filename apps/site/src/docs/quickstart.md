---
slug: quickstart
title: "Connect a client"
navTitle: "Quickstart"
description: "From nothing to a working connection: request access, add your player, then connect Claude.ai, Claude Desktop, Claude Code, or any MCP client to https://elixir.poapkings.com/mcp, with the exact steps for each and an honest note on ChatGPT."
order: 2
section: start
---

# Connect a client

Three things happen once, in this order: an account, a recorded player, a
connected client. Most of the elapsed time is waiting for two emails.

## 1. Get an account

Accounts are approved by hand. Use the request form on the [home page](/)
with your email and your Clash Royale player tag. You will hear back either
way. Once approved, sign in at [/signin](/signin): enter your email, then the
six-digit code from the mail (15 minutes, five attempts). The mail also
carries a one-click link; either works.

## 2. Add your player

On **Account → Overview**, add your player tag. Adding **is** recording: the
scheduler starts fetching your profile and battle log at its next tick, and
history builds from there. Your first player becomes your **primary**, which
is what every tool means when you omit `player_tag`. Add alts and friends the
same way and mark the relationship; every tier holds 50 players. See
[Recording and coverage](/docs/recording) for what gets fetched and how often.

You can connect a client while capture is still pending.

## 3. Connect

The endpoint is the same for every client:

```
https://elixir.poapkings.com/mcp
```

The door speaks Streamable HTTP over JSON and authenticates with OAuth 2.1
(dynamic client registration, PKCE S256, a `resource` parameter naming the
endpoint). The first connection asks for `cr:read` only; a write tool asks
for its own capability the first time you use it and the client reconnects
for it. Details are on the [Protocol reference](/docs/protocol).

### Claude.ai

1. **Settings → Connectors → Add custom connector.**
2. Name it (say, `Elixir MCP`) and paste `https://elixir.poapkings.com/mcp`.
   Leave the OAuth client id and secret empty: the door registers the client
   itself.
3. Click **Connect**. A sign-in page opens: enter your account email, then the
   six-digit code from the mail, and approve the listed capabilities.
4. In a chat, enable the connector under the tools menu and ask something.

The connector caches the tool list. When `elixir_changelog` or a response's
`contract_version` shows the contract moved, disconnect and reconnect the
connector to refresh it.

### Claude Desktop

Claude Desktop uses the same connector list as Claude.ai: **Settings →
Connectors → Add custom connector**, then the steps above. Remote connectors
need a plan that supports them; the desktop app's `claude_desktop_config.json`
stdio servers are a different mechanism and are not needed.

### Claude Code

```
claude mcp add --transport http elixir https://elixir.poapkings.com/mcp
```

Then run `/mcp` inside Claude Code and choose **Authenticate** for `elixir`;
the browser flow is the same email-and-code page. Use `--scope user` on the
add command if you want the connection in every project.

### Any MCP client

Your client needs: Streamable HTTP transport (POST only, JSON responses, no
SSE required), OAuth 2.1 with dynamic client registration and PKCE S256, and
RFC 8707 `resource` support. The sequence is:

1. `POST /mcp` without a token → 401 with `WWW-Authenticate: Bearer
   resource_metadata="https://elixir.poapkings.com/.well-known/oauth-protected-resource"`.
2. Read that document, then the authorization-server metadata it points to.
3. `POST /oauth/register` with your `redirect_uris` (https, or http on
   localhost / 127.0.0.1 / [::1]).
4. Send the user to `/oauth/authorize` with `client_id`, `redirect_uri`,
   `code_challenge` (S256), `scope=cr:read`,
   `resource=https://elixir.poapkings.com/mcp`, and `state`.
5. Exchange the code at `/oauth/token` with `code_verifier` and the same
   `resource`. Access tokens last an hour; refresh tokens rotate on every use.
6. `POST /mcp` with `Authorization: Bearer <access_token>` and an
   `initialize` request. Read `serverInfo.version` and `_meta`.

The official MCP SDKs implement steps 1 to 5; `mcp-remote` bridges a
stdio-only client to this flow.

### ChatGPT

ChatGPT's connector support is scoped to its own connector catalogue and to
developer-mode custom connectors whose availability depends on your plan and
region, and its expectations of a server (specific `search` and `fetch`
tools for deep research) differ from a general MCP tool surface. Elixir MCP
does not test against ChatGPT and makes no claim that it works there. If you
try it and it does, or does not, `elixir_feedback` is the place to say so.

## 4. Ask something

**Account → Overview** shows what is recorded for your primary so far and
offers starter questions matched to it: a snapshot review when only a profile
exists, a seven-day review once battles are in (30 days if the last week is
empty), a deck comparison when two decks appear, a week-over-week comparison
when both windows have battles. Copy one into your client. You never need
to tell the client your tag; if it starts by listing your players, that is a
bug worth reporting.

The same page counts successful player, battle and war reads through your
personal connections over the last seven days, so you can tell an authorized
connection from a working one. **Review activity** lists every call with its
`request_id`.

## What next

- [Users, agents and integrations](/docs/connections): a bot for a whole
  clan rather than a connection for yourself.
- [Tools](/docs/tools): everything the connection can call.
- [Reading a response](/docs/responses): the `meta` envelope every answer
  carries.
- [Limits](/docs/limits): what 500 calls a day actually bounds.

## If something goes wrong

Quote the `request_id` from the response's `meta` when you report an answer
that looks wrong. Your own call history, with those ids, is on **Account →
Activity**; refused credentials appear on **Account → Connections**.
