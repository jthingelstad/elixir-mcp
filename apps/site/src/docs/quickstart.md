---
slug: quickstart
title: "Connect your agent"
navTitle: "Quickstart"
description: "Get from nothing to asking your own agent about your Clash Royale history: request access, add your player, connect the MCP endpoint, ask a question."
order: 2
section: start
---

# Connect your agent

Five minutes, and most of it is waiting for an email.

## 1. Request access

Accounts are approved by hand — this is a hobby service, not an open signup.
Use the request form on the [home page](/) with your email and your Clash
Royale player tag. You will hear back either way.

## 2. Sign in

Once approved, sign in with your email. We send a six-digit code; there is no
password to forget.

## 3. Add your player

On your Account page, add your player tag.

**Adding is recording.** There is no separate opt-in step: adding a player
requests capture, and data arrives after a collector poll. History builds from there.
Your first player automatically becomes your **primary** — that is, you.

If you have alts, add them too and mark them as alts; the same for friends you
want to follow. See [Roles and quotas](/docs/roles) for how many you can hold
(50, at every tier).

## 4. Connect it

In Claude, or any MCP client, add a remote MCP server:

```
https://elixir.poapkings.com/mcp
```

You will be asked to sign in with the same email. The consent screen names
exactly what you are granting; reading is the default and every write capability
is asked for separately.

## 5. Ask it something

Open [Account → Overview](/account/overview). **Your next useful question**
shows your primary player, whether a profile or recent battles are actually
recorded, and whether you have an authorized personal connection. While waiting
for capture or a first data read, it checks again every minute while visible;
**Check again** refreshes it immediately. You can connect while capture is pending.

Copy one of its questions into your connected client:

- Only a profile: start with the recorded player snapshot, its observation time
  and the history available. One snapshot cannot establish progress.
- Recorded battles: review the last seven days, or the last 30 if none were
  recorded in the last seven. Counts include all game modes.
- Only older battles and no profile: inspect the retained history and its dates.
- At least two recorded decks in the last seven days: compare their results.
- Battles in both the last seven days and the preceding seven: compare those
  two periods. These are rolling windows, not calendar weeks.

The questions name your primary tag and ask the client to check coverage,
freshness, sample sizes and game modes. Having enough data to offer a comparison
does **not** establish statistical confidence or prove improvement. The panel
shows profile and battle-log observation times separately. **View the recorded
data** opens the same player's Explore page so you can check the evidence.

For a newly recorded player, start with what is available now. A month-long
trend becomes useful as that history accumulates; imported or previously
recorded appearances may already provide some of it.

You do not need to tell it your tag, and you should not have to watch it look
you up. If your agent starts by enumerating your players before answering a
question about you, something is wrong — tell us with `elixir_feedback`.

### Has the connection worked?

An authorized connection means consent is in place; it does not prove a tool
call has worked. The overview separately counts successful player, battle and
war tool responses through your personal MCP connections in the last seven
days, and the number of UTC dates on which those reads occurred. This includes
empty results and queries about players other than your primary. Website
previews, separate bots, setup calls, errors and oversized responses are excluded.

These counts come from existing call history, not from copying a question.
They are evidence of successful reads and repeat use, **not confirmation that
your client produced a useful answer**. **Review activity** shows the underlying
calls and their request IDs. A disconnected client can still have recent reads
in that history; reconnect before asking another question.

## What next

- [Users, agents and integrations](/docs/connections) — if you want a bot for
  your whole clan rather than a connection for yourself.
- [Tools](/docs/tools) — everything your agent can call.
- [The Explore page](/explore) — the same data, browsable, so you can check an
  answer by hand.

## If something goes wrong

Every response carries a `request_id`. Quote it when you report an answer that
looks wrong and we can find the exact call that produced it. Your own call
history is on **Account → Activity**.
