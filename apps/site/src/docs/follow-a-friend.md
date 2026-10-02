---
slug: follow-a-friend
title: "Follow a friend"
description: "Mark a player you track as a friend: how to add one in the console or through your agent, what a friend gets that a watched player does not (a card of their own, first, in Wednesday's Your friends this week, a name in your agent's opening), nicknames, the notifications switch, and stopping."
section: friends
order: 1
navTitle: "Follow a friend"
icon: heart
lede: "A friend is a player you follow on purpose. Elixir records them like anyone you track, and gives them a paragraph of their own in your Wednesday email."
console: ["Your tracked players", "/console/account/tracking", "Console ▸ Tracking"]
reviewed: "2026-10-01 against contract 9.17.1"
---

# Follow a friend

Every player you track has a relationship to you: you, an alt, a
friend, or someone you are watching ([Your account](/docs/your-account)
has the four). A friend is recorded exactly like any other tracked
player. What changes is how Elixir reads them back to you.

## Adding a friend

In the console:

1. **Console ▸ Tracking ▸ Track a player**: enter the tag and press
   **Track**. Added means recorded; capture starts on the next poll.
2. A new player starts as **watching**. Open the player from the
   Tracking table, and under **How you track it** set **Relationship**
   to **friend**.

Through your agent, `elixir_track_player` takes a `relationship`, so
"track #TAG as a friend" adds the player as a friend in one call. The
relationship is set when the player is added: for a player already on
your account, change it in the console.

A friend takes one of your tier's player slots, the same as a watched
player.

## What a friend gets

| | Friend | Watching |
|---|---|---|
| Recording | the same | the same |
| Your timeline | yes, while notifications are on | yes, while notifications are on |
| Wednesday's Your friends this week | a card of their own, first | a card if among the busiest, otherwise a line |
| Your agent's opening | named under "Friends you follow" | named under "You are also watching" |

In **Your friends this week** each friend who played gets a card under
their name and your nickname for them: the week's battles in each mode
with the wins and losses (each mode on its own line, never pooled),
their trophies, up to two moments such as a new arena, a promotion in
Path of Legends, a badge or a clan joined or left, and the deck they
played most, drawn card by card with how many of their battles it
carried. Friends come first, then the players you watch, busiest first:
ten full cards a week in all. A watched player past those gets one line;
anyone with no battle recorded is named once, together, at the end.
[Watch any player](/docs/watch-a-player) has that side.

Some things are only ever about you. A friend never gets
[milestone emails](/docs/milestones), never appears in "Your week in the
Arena", and cannot be [verified](/docs/verify) from your account: those
belong to your primary player and your alts.

## Nicknames

Give a friend a nickname on their page (**Nickname**, 1 to 40
characters) or through your agent with `elixir_nickname`. It is private
to you, your agent sees it, and Your friends this week uses it. A nickname
stays when you stop tracking the player, and an empty one clears it.

## The notifications switch

Each tracked player has a **Notifications** switch, on from the start;
your agent can flip it with `elixir_track_player` and `action:
"notify_off"` or `"notify_on"`. With it on, the player is a subject of your timeline, which your agent
and the console read. With it off, the player leaves your timeline and
Wednesday's Your friends this week too, while recording carries on.

## Stopping

**Stop tracking** on the player's page, or `elixir_track_player` with
`action: "remove"`. The history already recorded is kept, and recording
stops only when nobody else tracking the player has a reason to keep it.
