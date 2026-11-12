---
slug: connect-a-client
title: "Connect a client, step by step"
description: "How to connect Claude.ai, Claude Desktop, Claude Code, ChatGPT or any MCP client to your Elixir record, one client at a time."
section: connect
order: 2
navTitle: "Connect a client, step by step"
icon: plug
lede: "Point Claude, ChatGPT or any MCP client at Elixir and sign in once. Connecting an AI is optional."
---

# Connect a client, step by step

## Connect

Connect a client if you want an AI agent to ask Elixir about your
record. You can do this while recording is pending, or keep using Stats and Clan
in your browser. A connection authorizes access; it does not prove that a
successful data read has happened. Each connection's row under Settings ›
Connections & agents shows its last call and its calls in the last seven days.

The endpoint is the same for every client:

```
https://elixir.poapkings.com/mcp
```

The door speaks Streamable HTTP over JSON and authenticates with OAuth 2.1
(dynamic client registration, PKCE S256, a `resource` parameter naming the
endpoint). A client that names no scope asks for `cr:read` alone, and the
consent page offers every other capability as a checkbox, unticked on your
own connection: tick what you want to allow, and change it later under
Settings › Connections & agents. Details are on the [Protocol reference](/docs/protocol).

### Claude.ai

1. **Settings → Connectors → Add custom connector.**
2. Name it (say, `Elixir`) and paste `https://elixir.poapkings.com/mcp`.
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
   resource_metadata="https://elixir.poapkings.com/.well-known/oauth-protected-resource",
   scope="<every standard capability>"`.
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
tools for deep research) differ from a general MCP tool surface. Elixir
does not test against ChatGPT and makes no claim that it works there. If you
try it and it does, or does not, `elixir_send_feedback` is the place to say so.
