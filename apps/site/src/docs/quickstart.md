---
slug: quickstart
title: "Get started with Elixir"
description: "Create your account, track your player and read recorded history in Ladder. Clan war history and AI clients are optional, with connection instructions when you want them."
section: start
order: 2
navTitle: "Quickstart"
icon: rocket
lede: "Create your account, track your player, and read captured history in Ladder. Add clan war history or an AI client when you want them."
reviewed: "2026-10-08 against contract 11.4.0"
---

# Get started with Elixir

Start with an account and the player you play as. You can read your captured
record in [Ladder](/ladder) with this account, without connecting an AI client.
Clan war history and AI clients are optional. The steps below tell you what
to do next and what the current record can show.

## 1. Get an account

Anyone can create a free ordinary member account at
[/console/signin?signup](/console/signin?signup). Enter your email, then verify
the six-digit code or one-click link (15 minutes, five code attempts).
Signing in and creating an account use the same form. No invitation or
collector is required. Restricted accounts stay restricted.

## 2. Track your player

Open [Console ▸ Tracking](/console/account/tracking) and add your Clash Royale
player tag. Your first player is your **primary**, which is what every tool
means when you omit `player_tag`. Tracking **is** recording: Elixir reads
your profile straight away and your battle log at the scheduler's next tick,
so the first capture usually lands within a few minutes, with roughly your
last 30 battles (all the game keeps); history builds from there. Once your
profile shows your clan, Elixir follows that clan for you at activity scope,
which is what puts your clan's week in your Monday email ([Your player's
clan](/docs/recording#your-players-clan)); a player in no clan follows
nothing. Add alts and friends the same way and mark the relationship;
the existing [tier limits](/docs/roles) still apply. See
[Recording and coverage](/docs/recording) for what gets fetched and how often.

Find your tag in Clash Royale by opening your player profile: it appears below
your name. If the game has no player with the tag you typed, your player's
page says **Tag not found** within minutes: stop tracking it and add the
right one. Email verification opens your Elixir account; [player
verification](/docs/verify) separately proves ownership for the features that
require it. An ordinary member account includes activity clan recording, not
comprehensive capture of every member. Tracking shows the available slots.

Read your personal season in [Ladder](/ladder). Adding a tag opens
your player's Tracking record. **Player tag saved** means
the tag is on your account, not that a profile has arrived or ownership has
been proved. This page checks saved data about once a minute while capture is
pending; **Check again** reads the record without forcing a game fetch. The
first capture usually lands within a few minutes; until it does, Ladder says
it is on its way rather than showing an empty season.

**View recorded profile** opens the saved profile and its dated trophies and
lifetime counters. **Browse recorded battles** opens captured battles newest
first, including retained history older than 30 days; **Older battles** reads
the next page. A profile alone does not establish captured battle history.
Recorded clan history links to a specific saved war week, independently of
private Clan actions. AI setup is optional and follows these browser reads.

Capture attempts and saved facts are separate: a recent failed fetch does not
make a tag invalid or remove retained information. An incomplete measured
profile interval names its bounds and captured/expected counts; other time
remains unknown, even after a successful poll. Error receipts have bounded
retention, so missing error metadata does not establish a successful capture.
Paused or stopped recording still links to the information already saved.
Check Tracking for status rather than treating an empty window as proof that
you did not play.

If you want clan war history, follow [Bring your clan](/docs/bring-your-clan).
Private Clan actions still require verified membership and the appropriate game
role. Running a collector is optional and requires separate operator approval;
it does not multiply the shared fetch budget.

## 3. Connect

**Optional:** connect a client if you want an AI agent to ask Elixir about your
record. You can do this while capture is pending, or keep using Ladder and Clan
in your browser. A connection authorizes access; it does not prove that a
successful data read has happened. Console reports observed data reads within
the last seven days separately from active connections.

The endpoint is the same for every client:

```
https://elixir.poapkings.com/mcp
```

The door speaks Streamable HTTP over JSON and authenticates with OAuth 2.1
(dynamic client registration, PKCE S256, a `resource` parameter naming the
endpoint). A client that names no scope asks for `cr:read` alone, and the
consent page offers every other capability as a checkbox, unticked on your
own connection: tick what you want to allow, and change it later under
Account → Connections. Details are on the [Protocol reference](/docs/protocol).

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
tools for deep research) differ from a general MCP tool surface. Elixir
does not test against ChatGPT and makes no claim that it works there. If you
try it and it does, or does not, `elixir_send_feedback` is the place to say so.

## 4. Ask something

**Optional: ask through an AI client.**

**Account → Overview** shows what is recorded for your primary so far,
links to your next step in Tracking or Ladder, and offers an optional first
question matched to that record. A profile is enough to start. Active client
connections and successful data reads in the last seven days are reported
separately: authorizing a connection alone does not confirm a data read.

**Account → Connections** offers more starter questions matched to it under
**Try asking…**: a snapshot review when only a profile exists, a seven-day
review once battles are in (30 days if the last week is empty), a deck
comparison when two decks appear, a week-over-week comparison when both
windows have battles. Copy one into your client. You never need to tell
the client your tag; if it starts by listing your players, that is a bug
worth reporting. The agent can also read this manual itself: `elixir_docs`
serves these pages over the connection, and the ten
[examples](/examples/play) are offered as prompts, so "how do I scout a
bracket?" is a question it can answer before it calls anything.

Connections also counts each connection's calls over the last seven days,
so you can tell an authorized connection from a working one. **Usage ▸ MCP
requests** lists every call with its `request_id`.

## What next

- [Users, agents and integrations](/docs/connections): a bot for a whole
  clan rather than a connection for yourself.
- [Tools](/docs/tools): everything the connection can call.
- [Reading a response](/docs/responses): the `meta` envelope every answer
  carries.
- [Limits](/docs/limits): account quotas and how calls are counted.

## If something goes wrong

Quote the `request_id` from the response's `meta` when you report an answer
that looks wrong. Your own call history, with those ids, is under **Usage ▸
MCP requests**; refused credentials appear on **Account → Connections**.
