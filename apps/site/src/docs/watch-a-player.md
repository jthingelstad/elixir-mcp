---
slug: watch-a-player
title: "Watch any player"
description: "Track any player by tag, friend or not: adding one starts recording, what the record holds before and after, how a watched player shows in your timeline and Wednesday's Your friends this week, your player slots, and how an agent tracks."
section: friends
order: 2
navTitle: "Watch any player"
icon: eye
lede: "Any player with a tag can be tracked. Adding one is recording it, from the next poll on, and a watched player gets a line in your Wednesday email."
console: ["Track a player", "/console/account/tracking", "Console ▸ Tracking"]
reviewed: "2026-10-01 against contract 9.17.1"
---

# Watch any player

You do not need to know a player to track them: a rival, a top player,
a clanmate's alt. **Watching** is the relationship every added player
starts with, and it is the whole of what an agent can do.

## Adding a player

**Console ▸ Tracking ▸ Track a player**: enter the tag and press
**Track**. Through your agent, `elixir_track_player` with the tag; with
no `relationship` it watches.

Tracked means recorded. Capture starts on the next poll and carries on
until you remove the player: the battle log about every 30 minutes
while they are playing, backing off to two hours when they are not,
and the profile daily and after a session. If someone else already
tracks the player you share the record they built, so its history can
start before the day you added it. [What Elixir records](/docs/recording)
has the schedule and what each poll reads.

## Slots

Every tracked player takes one of your tier's player slots, whatever
the relationship; **Console ▸ Tracking** shows how many you use. When
they are full, adding another is refused until you remove one, ask for
more on your profile, or run a collector for bonus slots.
[Roles and tiers](/docs/roles) has the numbers.

## What you see

A watched player is a subject of your **timeline** while its
**Notifications** switch is on: sittings, new arenas, promotions, clan
changes, in the console and through `elixir_timeline`.

In Wednesday's **Your friends this week**, watched players share a table, one
row each: the week's battles with wins and losses and the modes, or
"no recorded battles", with a note when they came back after quiet
days, joined or left a clan, reached an arena or were promoted. Players
with nothing recorded all week are named together in one quiet line. A
[friend](/docs/follow-a-friend) gets a full paragraph instead.

Your agent's opening lists the players you watch with their tags, so
you can ask about one by name.

## Agents

An agent you own can track players, and it always tracks them as
watching: it can never make a player you or a friend. Its players
spend your slots. See [Your agents](/docs/agents).

## Stopping

**Stop tracking** on the player's page, or `elixir_track_player` with
`action: "remove"`. What was recorded stays recorded.
