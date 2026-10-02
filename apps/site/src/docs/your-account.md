---
slug: your-account
title: "Your account"
description: "Your Elixir account: asking for access, signing in with an emailed code or link, how long a sign-in lasts, your primary player and the others you track, your time zone, your tier, what stays private, and how to have the account removed."
section: start
order: 3
navTitle: "Your account"
icon: user-round
lede: "One account, opened by hand, signed in with an email and no password. It holds your players, your time zone and your tier, and it shows nobody your address."
console: ["Your profile and tier", "/console/account/profile", "Console ▸ Profile"]
reviewed: "2026-10-01 against contract 9.17.1"
---

# Your account

Everything in Elixir hangs off one account: the console, Elixir Clan,
the emails and your own AI agent all act as the same person. The
account is an email address, the players you track and a few settings.
There is no password.

## Asking for access

Accounts are opened by hand while the recorder grows. Ask at
[/console/signin?request](/console/signin?request) with your email, your
player tag and, if you like, a note. Whatever happened to an earlier
request, the answer on the page is the same, and an email comes when the
account opens; there is no need to check back.

When the account opens, the player you asked with is already on it as
your **primary player**, and its clan is recorded with it. The welcome
email links to the [Quickstart](/docs/quickstart), which goes on from
there to connecting your own agent.

## Signing in

Sign in at [/console/signin](/console/signin) with your email. Elixir
sends a link and a six-digit code; either one signs you in, each can be
used once, and both expire after 15 minutes. A code allows five tries.
The link signs in the device you open it on, and the page that asked
for it signs in too: at once when the link is opened from the same
network, and only after you say yes on the link's page when it is
opened from somewhere else.

A sign-in lasts **thirty days from its last use and ninety days at
most**. **Console ▸ Profile ▸ Devices** lists every session that can act
as you, with a sign-out for each and **Sign out everywhere else**, which
keeps the one you are using. Your agents and connected apps are not
sessions; they are under [Connections](/docs/connections).

## Your players

The players on your account each say who they are to you:

| Relationship | Means | Shows in the console as |
|---|---|---|
| primary | you: what every tool means when no player is named | you |
| alt | also you, under another tag | alt |
| friend | someone you follow on purpose | friend |
| watching | anyone else you added | watching |

Your first player is your primary. **Make primary** on another player's
page moves it there, and the old primary becomes watching. Your primary
cannot be removed while you track other players: make another one
primary first. Your primary and your alts are the players you can
[prove are yours](/docs/verify), and the ones your milestone emails and
Elixir Clan go by. Friends and watched players are covered in
[Follow a friend](/docs/follow-a-friend) and
[Watch any player](/docs/watch-a-player).

Players are added under **Console ▸ Tracking**, and tracking a player is
recording it: see [What Elixir records](/docs/recording).

## Your time zone

**Console ▸ Profile ▸ Timezone** starts at UTC. It sets the times the
console shows, how a date in a question to your agent resolves, the
local times in tool responses and the days your emails name. Storage
stays in UTC; only the reading changes.

## Your tier

Your tier sets how many players and clans you can record and how many
tool calls you can make a day; **Console ▸ Profile** shows each limit
beside what you use. Tiers are granted by hand. **Ask for more slots**
on the same page sends a request that a person reviews, one at a time.
Running a collector adds slots of its own. The tiers and their numbers
are on [Roles and tiers](/docs/roles).

## What stays private

Your email address is never shown anywhere public. The players on your
account, what each one is to you and the nicknames you give them are
yours: what you connect to Elixir as yourself reads them, and nobody
else does. The game record
itself (battles, profiles, clans) is public game data, and every
approved account can read it. The one public line tied to an account is
a collector's: the public list of collectors names the operator's
primary player.

## Removing the account

There is no delete button. Write to admin@poapkings.com, or send it as
feedback from the console, and the removal is carried out in one
reviewed step: your address, your players and clans, your agents and
their keys, your connections, sessions, call history, feedback and the
mail sent to you go. The public game record stays. A collector you run
has to be revoked first. The [privacy page](/docs/privacy) has the rest.
