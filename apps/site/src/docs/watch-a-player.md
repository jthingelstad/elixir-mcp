---
slug: watch-a-player
title: "Watch any player"
description: "Follow any player by tag, friend or not: adding one starts recording, what the record holds before and after, how a watched player shows in your timeline and your digest, your player slots, and how an Elixir agent follows."
section: friends
order: 2
navTitle: "Watch any player"
icon: eye
lede: "Any player with a tag can be followed. Adding one is recording it, from the next read on, and a watched player who played or posted is in your digest."
reviewed: "2026-11-12 your digest; 2026-10-01 against contract 9.17.1"
callout: ["Open it at Settings › Players & following", "/settings/players", "Open Players & following"]
---

# Watch any player

You do not need to know a player to follow them: a rival, a top player,
a clanmate's alt. **Watching** is the relationship an added player
starts with (your first player is your primary), and the only one an
[agent](/docs/agents) can set.

## Adding a player

**Settings › Players & following › Follow a player**: enter the tag and press
**Follow**. Through a [connected app](/docs/connections), `elixir_follow_player`
with the tag; with no `relationship` it watches.

Followed means recorded. Recording starts on the next read and carries on
until you remove the player: the battle log about every 30 minutes
while they are playing, backing off to two hours when they are not,
and the profile daily and after a session. If someone else already
follows the player you share the record they built, so its history can
start before the day you added it. [What Elixir records](/docs/recording)
has the schedule and what each read reads.

## Slots

Every followed player takes one of your player slots, whatever
the relationship; **Settings › Players & following** shows how many you use. When
they are full, adding another is refused until you remove one or your slots
rise: lead a clan you follow, or run a collector.
[Roles and limits](/docs/roles#upgrades) has the numbers.

## What you see

A watched player is a subject of your **timeline** while its
**Notifications** switch is on: sittings, new arenas, promotions, clan
changes, on Home and through `elixir_timeline`.

In **[your digest](/docs/email#your-digest)**, the players you watch
come after your [friends](/docs/follow-a-friend), whoever has the most
to tell first, then the busiest, shown as a friend is: their battles
with wins and losses, their trophies, and up to three things (their
highlights, a new arena or league, a clan joined or left, a return),
twelve people in all with the rest counted. A player who neither played
nor posted is left out.

The opening a connected app reads lists the players you watch with
their tags (or counts them, when the list is long), so you can ask about
one by name. Every battle the record holds has
[a public page](/docs/battles#a-battles-page), the link a connected app
hands you for one battle.

## Agents

An agent you own can follow players, and it always follows them as
watching: it can never make a player you or a friend. Its players
spend your slots. See [Your agents](/docs/agents).

## Stopping

**Stop following** on the player's page, or `elixir_follow_player` with
`action: "remove"`. What was recorded stays recorded.
