---
slug: follow-a-friend
title: "Follow a friend"
description: "Mark a player you track as a friend: how to add one on the website or through a connected app, what a friend gets that a watched player does not (first in your digest, a name in your connection's opening), nicknames, the notifications switch, and stopping."
section: friends
order: 1
navTitle: "Follow a friend"
icon: heart
lede: "A friend is a player you follow on purpose. Elixir records them like anyone you track, and puts them first in your digest."
reviewed: "2026-11-12 the digest replaces Your friends this week; 2026-10-01 against contract 9.17.1"
callout: ["Open it at Settings › Players & tracking", "/settings/players", "Open Players & tracking"]
---

# Follow a friend

Every player you track has a relationship to you: you, an alt, a
friend, or someone you are watching ([Your account](/docs/your-account)
has the four). A friend is recorded exactly like any other tracked
player. What changes is how Elixir reads them back to you.

## Adding a friend

On the website:

1. **Settings › Players & tracking › Track a player**: enter the tag and press
   **Track**. Added means recorded; recording starts on the next read.
2. A new player starts as **watching** (your first is your primary).
   Open the player from the Players table, and under **How you track
   it** set **Relationship** to **friend**.

Or on Home's **Friends** tab: **Follow a friend** takes the tag and adds
the player as a friend in one step. It asks for your own player first if you
have none, and never makes the player your primary. They aren't told.

A first player named `friend` or `watching` stays that, and the account has no
player of its own until you name one with `relationship: "primary"`.
Through a [connected app](/docs/connections), `elixir_track_player` takes a `relationship`, so
"track #TAG as a friend" adds the player as a friend in one call. The
relationship is set when the player is added: for a player already on
your account, change it under Settings › Players & tracking. An [agent](/docs/agents) you own
tracks players as watching only.

A friend takes one of your player slots, the same as a watched
player, unless Elixir already records them: a member of a clan recorded in
full, or a player another account followed first, is free. Home's Follow and
the search sheet say which before you tap ([What a player slot
costs](/docs/recording#what-a-player-slot-costs)).

## What a friend gets

| | Friend | Watching |
|---|---|---|
| Recording | the same | the same |
| Your timeline | yes, while notifications are on | yes, while notifications are on |
| [Your digest](/docs/email#your-digest) | first, when they played or posted | after your friends, when they played or posted |
| Your connection's opening | named under "Friends you follow" | named under "You are also watching" |

In **[your digest](/docs/email#your-digest)** (weekly on Wednesdays, or
daily by your choice) each friend who played or posted is shown under
their name and your nickname for them: their battles with the wins and
losses, their trophies, and up to three things, their
[highlights](/docs/timeline#highlights) first with their own words, then
a big first such as a new arena or a clan joined or left, each with a
link to its battle when the record knows it. Friends come first, then
the players you watch, up to twelve in all with the rest counted. Anyone
who neither played nor posted is left out.
[Watch any player](/docs/watch-a-player) has that side.

Some things are only ever about you. A friend never gets
[milestone emails](/docs/milestones), never appears in "Your week in the
Arena", and cannot be [verified](/docs/verify) from your account: those
belong to your primary player and your alts.

## Nicknames

Give a friend a nickname on their page (**Nickname**, 1 to 40
characters) or through a connected app with `elixir_nickname`. It is private
to you (apps you connect as yourself see it; an agent keeps its own), and your digest uses it. A nickname
stays when you stop tracking the player, and an empty one clears it.

## The notifications switch

Each tracked player has a **Notifications** switch, on from the start;
a connected app can flip it with `elixir_track_player` and `action:
"notify_off"` or `"notify_on"`. With it on, the player is a subject of your timeline, which your connected apps
and Home read. With it off, the player leaves your timeline and
your digest too, while recording carries on.

## Stopping

**Stop tracking** on the player's page, or `elixir_track_player` with
`action: "remove"`. The history already recorded is kept, and recording
stops only when nobody else tracking the player has a reason to keep it.
