---
slug: quickstart
title: "Get started with Elixir"
description: "Sign in, add your player, follow a few people and choose your digest: the four steps from a new account to a feed of your friends and your clan. Connecting an AI is optional."
section: start
order: 2
navTitle: "Quickstart"
icon: rocket
lede: "Sign in, add your player, follow a few people, and choose your digest."
reviewed: "2026-11-13 against Home's welcome steps"
---

# Get started with Elixir

Elixir is the missing social layer of Clash Royale: follow your friends and
your clan, see how they play, and cheer them on. Getting there takes four
steps, and **Home** keeps them in a short list, **Welcome to Elixir**, until
they are done.

## 1. Sign in

Open [/signin?signup](/signin?signup) and enter your email. Elixir sends a
sign-in link and a six-digit code; use either (15 minutes, five code
attempts). Signing in and creating an account use the same form, and an
account is free. The signup form asks whether you are 13 or older; Elixir
accounts are for people who are. No invitation is needed.

The signup form also asks for **your player tag**, optionally. A tag that is
not a Clash Royale tag is refused on the form, before any email is sent;
leave the field empty to add your player later. A tag given while signing in
to an account that already exists is ignored; that account keeps its
players.

## 2. Add your player

If you gave your tag at signup, this step is done. Otherwise **Home** asks for
it, or open [Settings › Players & following](/settings/players). Find your
tag in Clash Royale by opening your player profile: it appears below your
name. Your first player is your **primary**.

Your profile and roughly your last 30 battles (all the game keeps) usually
arrive within a minute, a few at busy times; everything after is recorded as
it happens. If the game has no player with the tag you typed, your player's
page says **Tag not found** within seconds, with the place to fix it. Once
your profile shows your clan, Elixir follows that clan for you
([Your player's clan](/docs/recording#your-players-clan)).

Home's list then asks you to **verify it's you**: play one battle with a deck
Elixir names, win or lose ([Verify](/docs/verify)). A verified player is
what lets you [highlight a battle](/docs/battles#highlight-a-battle) and act
in your clan's Clan pages in your game role.

## 3. Follow a few people

Open **Find** (on the top bar, and a tab on a phone). It has your clan's
members with **Follow my clan**, **Follow a friend** by tag, the players you
met in your own battles, and the clan directory
([Find](/docs/follow-a-friend#find)). Home's **People to follow** suggests a
few more, and says why each is there.

The people you follow fill **Home's feed**: their sessions, their firsts and
their highlights, newest first ([The timeline](/docs/timeline)). Give any
item a [cheer](/docs/timeline#cheers). Open a name for that player's page.
A follow takes one of your player slots only when Elixir records that player
because of you; following someone Elixir already records is free
([Roles and quotas](/docs/roles#followed-means-recorded)). Settings ›
Players & following shows the slots you have.

## 4. Choose your digest

Your digest is the one scheduled email: the people you follow, your clan's
news and your own week, in one mail. It comes weekly, on Wednesdays, unless
you choose daily or off in [Settings › Emails](/settings/emails); any choice,
off included, finishes this step. A digest with nothing to tell is not sent.
[Email](/docs/email#your-digest) has what it holds.

## See how you play

**You** is your own player page, and its [Stats](/home/you/stats) tab is
your season as Elixir recorded it, one mode at a time
([how to read it](/docs/ladder)). Each player
page's **Record** tab opens the saved profile and the last 30 days as
recorded. A gap in a window means unknown: Elixir saw nothing then, which is
not proof that nobody played ([Freshness and gaps](/docs/freshness-and-gaps)).

## Ask your AI

Optional. Elixir also serves what it records to your own AI agent over MCP.
[Connect a client](/docs/connect-a-client) first, then **Settings ›
Connections & agents** offers starter questions under **Try asking…**,
matched to what is recorded for your player. You never need to tell the
client your tag. The agent can read this manual itself: `elixir_docs` serves
these pages over the connection.

Connections counts each connection's calls over the last seven days, so you
can tell an authorized connection from a working one. **Settings › Usage and
limits › Requests** lists every call with its `request_id`.

## What next

- [Bring your clan](/docs/bring-your-clan): your clan's week, and the
  policy your leaders run it by.
- [Follow a friend](/docs/follow-a-friend): friends, watched players and
  nicknames.
- [Users, agents and integrations](/docs/connections): a bot for a whole
  clan rather than a connection for yourself.
- [Tools](/docs/tools): everything a connection can call.

## If something goes wrong

Send feedback from Settings, or quote the `request_id` from a response's
`meta` when you report an answer that looks wrong. Your own call history,
with those ids, is under **Settings › Usage and limits › Requests**; refused
credentials appear on **Settings › Connections & agents**.
