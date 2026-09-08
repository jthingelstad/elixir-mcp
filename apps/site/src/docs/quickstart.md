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

**Adding is recording.** There is no separate opt-in step: the moment you add a
player we start capturing their battles, and the history builds from there.
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

Your connection already knows who you are, so you can go straight to the
question:

> *"How has my ladder win rate trended over the last month?"*
> *"Which of my decks actually performs, not just which I play most?"*
> *"How are my friends doing this week?"*
> *"What's our clan's war attendance looking like?"*

You do not need to tell it your tag, and you should not have to watch it look
you up. If your agent starts by enumerating your players before answering a
question about you, something is wrong — tell us with `elixir_feedback`.

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
