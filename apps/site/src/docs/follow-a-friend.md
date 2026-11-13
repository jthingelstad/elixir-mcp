---
slug: follow-a-friend
title: "Follow a friend"
description: "Mark a player you follow as a friend: how to add one on the website or through a connected app, what a friend gets that a watched player does not (first in your digest, a name in your connection's opening), nicknames, the notifications switch, and stopping."
section: friends
order: 1
navTitle: "Follow a friend"
icon: heart
lede: "A friend is a player you follow on purpose. Elixir records them like anyone you follow, and puts them first in your digest."
reviewed: "2026-11-13 Find opens on Suggested; 2026-11-12 your digest; 2026-10-01 against contract 9.17.1"
callout: ["Open it at Settings › Players & following", "/settings/players", "Open Players & following"]
---

# Follow a friend

Every player you follow has a relationship to you: you, an alt, a
friend, or someone you are watching ([Your account](/docs/your-account)
has the four). A friend is recorded exactly like any other followed
player. What changes is how Elixir reads them back to you.

## Adding a friend

On the website:

1. **Settings › Players & following › Follow a player**: enter the tag and press
   **Follow**. Added means recorded; recording starts on the next read.
2. A new player starts as **watching** (your first is your primary).
   Open the player from the Players table, and under **How you follow
   it** set **Relationship** to **friend**.

Or on **Find** (on the top bar, and a tab on a phone): under **Search**,
**Follow by player tag** takes the tag and adds
the player as a friend in one step. It asks for your own player first if you
have none, and never makes the player your primary. They aren't told.

## Find

Find is where you look for people to follow, in sections. It opens on
**Suggested**.

| Section | What it holds |
|---|---|
| Suggested | a list to tap through: players you had a friendly battle with or teamed up with in 2v2 (or met twice) in the last 30 days, the players followed by the people you follow ("Ada follows them"), and your clan, taking turns. Each says why and what following costs. Ten show, then **Show more** (up to 30). With nobody to suggest yet, it says what fills it and offers Search and your Follow me link |
| Your clan | your player's clan now: each member, what following them costs, and **Follow my clan**, asked once with the same pricing and refusal as following a clan from a player's page; then **Invite clanmates**, words to bring the rest of your clan to Elixir ([Bring your clanmates](/docs/bring-your-clan#bring-your-clanmates)) |
| Search | the search sheet (players Elixir has seen, by name or tag; clans, cards and help), and **Follow by player tag** for anyone else |
| From your battles | the players your own players met in the last 30 days, opponents and 2v2 teammates: players you had a friendly battle with first, then your 2v2 teammates, then the most met. How often, how it went for you ("A friendly battle · Met once · 1 win") and when last. From the log only, never a rating. Players you follow are marked, never hidden |
| Clan directory | every clan on Elixir |
| Your link | your Follow me link ([A player's page](/docs/player-page#follow-me-links)) |

Your clan, From your battles and Your link need a player of your own.
Each person shows their game name and tag, never a nickname. Home's
**People to follow** and **People you know** draw from the same places
([Beside the feed](/docs/timeline#beside-the-feed), [People you
know](/docs/timeline#people-you-know)).

A first player named `friend` or `watching` stays that, and the account has no
player of its own until you name one with `relationship: "primary"`.
Through a [connected app](/docs/connections), `elixir_follow_player` takes a `relationship`, so
"follow #TAG as a friend" adds the player as a friend in one call. The
relationship is set when the player is added: for a player already on
your account, change it under Settings › Players & following. An [agent](/docs/agents) you own
follows players as watching only.

A friend takes one of your player slots, the same as a watched
player, unless Elixir already records them: a member of a clan recorded in
full, or a player another account followed first, is free. Find's Follow and
the search sheet say which before you tap ([What a player slot
costs](/docs/recording#what-a-player-slot-costs)).

## What a friend gets

| | Friend | Watching |
|---|---|---|
| Recording | the same | the same |
| Your timeline | yes, while notifications are on | yes, while notifications are on |
| [Your digest](/docs/email#your-digest) | first, when they played or posted | after your friends, when they played or posted |
| Your connection's opening | named under "Friends you follow" | named under "You are also watching" |

In **[your digest](/docs/email#your-digest)** (weekly on Mondays, or
daily by your choice) each friend who played or posted is shown under
their name and your nickname for them: their battles with the wins and
losses, their trophies, and up to three things, their
[highlights](/docs/timeline#highlights) first with their own words, then
a big first such as a new arena or a clan joined or left, each with a
link to its battle when the record knows it. Friends come first, then
the players you watch, up to twelve in all with the rest counted. Anyone
who neither played nor posted is left out.
[Watch any player](/docs/watch-a-player) has that side.

Some things are only ever about you. A friend's
[firsts](/docs/milestones) are told under the friend in your digest, never
in your own part of it, and a friend cannot be [verified](/docs/verify)
from your account: that belongs to your primary player and your alts.

## Nicknames

Give a friend a nickname on their page (**Nickname**, 1 to 40
characters) or through a connected app with `elixir_nickname`. It is private
to you (apps you connect as yourself see it; an agent keeps its own), and your digest uses it. A nickname
stays when you stop following the player, and an empty one clears it.

## The notifications switch

Each followed player has a **Notifications** switch, on from the start;
a connected app can flip it with `elixir_follow_player` and `action:
"notify_off"` or `"notify_on"`. With it on, the player is a subject of your timeline, which your connected apps
and Home read. With it off, the player leaves your timeline and
your digest too, while recording carries on.

## Stopping

**Stop following** on the player's page, or `elixir_follow_player` with
`action: "remove"`. The history already recorded is kept, and recording
stops only when nobody else following the player has a reason to keep it.
