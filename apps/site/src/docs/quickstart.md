---
slug: quickstart
title: "Get started with Elixir"
description: "Four steps from a new account to a feed of your friends and your clan: sign in, add your player tag, follow a few people and choose your digest. Connecting an AI is optional."
section: start
order: 2
navTitle: "Quickstart"
icon: rocket
lede: "Sign in, add your player tag, follow a few people and choose your digest. That's it."
reviewed: "2026-11-13 against Home's welcome steps"
---

# Get started with Elixir

Elixir is the missing social layer of Clash Royale: follow your friends and
your clan, see how they play, and cheer them on.

Getting set up takes four steps. **Home** keeps them in a short list,
**Welcome to Elixir**, until you've done them all.

## 1. Sign in

Open [/signin?signup](/signin?signup) and enter your email. We send you a
link and a six-digit code. Use either one within 15 minutes (the code allows
five tries).

- It's free, and no invite is needed.
- Signing in and creating an account use the same form.
- Elixir accounts are for players 13 or older, so the form asks.

The form also has a spot for **your player tag**. It's optional: skip it and
add your player later. A tag that isn't a real Clash Royale tag is caught
before any email goes out. If you already have an account, a tag typed here
is ignored and your players stay as they are.

## 2. Add your player

Gave your tag at signup? This step is done. If not, **Home** asks for it, or
use [Settings › Players & following](/settings/players).

To find your tag, open your profile in Clash Royale. It's the code starting
with **#** below your name. Your first player becomes your **primary**.

Your profile and about your last 30 battles (all the game keeps) usually
show up within a minute. From then on, every battle is recorded as you play.
Typo in the tag? Your player's page says **Tag not found** within seconds,
and you fix it right there.

Once your profile shows your clan, Elixir follows that clan for you
([Your player's clan](/docs/recording#your-players-clan)).

Next, Home asks you to **verify it's you**: play one battle with a deck Elixir
names. Win or lose, it counts ([Verify](/docs/verify)). A verified player can
[highlight a battle](/docs/battles#highlight-a-battle) and act in Clan with
their in-game role.

## 3. Follow a few people

Open **Find** (in the top bar, or the tab at the bottom on your phone). In
there:

- **Your clan**: your clanmates, and **Follow my clan**.
- **Follow a friend**: type a player tag.
- **From your battles**: players you met in your own battles.
- **The clan directory**: every clan on Elixir.

Home's **People to follow** suggests a few more, and says why each one is
there ([Find](/docs/follow-a-friend#find)).

Everyone you follow fills **Home's feed**: their sessions, their firsts and
their best battles, newest first ([The timeline](/docs/timeline)). Tap
**Cheer** on anything to [cheer them on](/docs/timeline#cheers). Tap a name
to open that player's page.

Following someone Elixir already records is free. A follow only takes one of
your player slots when Elixir records that player because of you
([Roles and quotas](/docs/roles#followed-means-recorded)). Settings ›
Players & following shows how many slots you have.

## 4. Choose your digest

Your digest is one email with the people you follow, your clan's news and
your own week. It's the only email Elixir sends on a schedule.

- **Weekly**, on Mondays right after the weekly reset. That's the default.
- **Daily**, if you want more.
- **Off**, if you'd rather not.

Pick one in [Settings › Emails](/settings/emails). Any choice, even off,
finishes this step. Nothing happened? No digest. [Email](/docs/email#your-digest)
has the details.

## See how you play

**You** is your own player page. Its [Stats](/home/you/stats) tab is your
season, one game mode at a time ([how to read it](/docs/ladder)). Every
player page also has a **Record** tab: the saved profile and the last 30 days.

A gap means Elixir didn't see those battles, not that nobody played
([Freshness and gaps](/docs/freshness-and-gaps)).

## Ask your AI

Optional. You can connect your own AI agent to Elixir over MCP and ask about
your battles, your friends and your clan.

[Connect a client](/docs/connect-a-client) first. Then **Settings ›
Connections & agents** suggests questions to start with, under **Try
asking…**. You never need to tell it your tag. The agent can read these docs
itself, through `elixir_docs`.

Connections shows each connection's calls for the last seven days, so you can
tell a working connection from one that's only signed in. **Settings › Usage
and limits › Requests** lists every call with its `request_id`.

## What next

- [Bring your clan](/docs/bring-your-clan): your clan's week, and the rules
  your Leader and Co-Leaders run it by.
- [Follow a friend](/docs/follow-a-friend): friends, watched players and
  nicknames.
- [Users and agents](/docs/connections): a bot for your whole
  clan instead of a connection just for you.
- [Tools](/docs/tools): everything a connection can call.

## If something goes wrong

Send feedback from Settings. If an AI answer looks wrong, include the
`request_id` from the response's `meta`. Your call history, with those ids,
is under **Settings › Usage and limits › Requests**. Refused connections show
on **Settings › Connections & agents**.
