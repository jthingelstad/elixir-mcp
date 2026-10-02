---
slug: modes
title: "Modes"
description: "Why Elixir keeps Trophy Road, Path of Legends, Clan Wars, casual, challenges, events and tournaments apart: the seven mode groups, the note a number carries when it mixes them, how events are told apart, how Clan Wars games are counted, and how to ask for one mode."
section: record
order: 2
navTitle: "Modes"
icon: gamepad-2
lede: "Trophy Road, Path of Legends and Clan Wars are different games. Elixir keeps every mode apart, and a number that mixes them says so."
reviewed: "2026-10-01 against contract 9.17.1"
---

# Modes

The same deck plays a different game on Trophy Road, in Path of Legends
and in a war duel: who you are matched against, the card levels on the
other side and what is at stake all change. A win rate that adds them
together describes none of them. So Elixir sorts every battle into a
**mode group**, reads each group on its own, and says when a number has
mixed them.

## The seven groups

| Group | In the game |
|---|---|
| `ladder` | Trophy Road |
| `ranked` | Path of Legends |
| `war` | Clan Wars: river race battles, duels and boat battles |
| `casual` | 2v2, friendly and clanmate battles |
| `challenge` | challenges |
| `event` | event content: any battle the game marks with an event tag, except a clanmate battle |
| `tournament` | tournaments |

Every battle is in exactly one group, decided by the battle's type and
its event tag. [The battle model](/docs/battles#mode-groups) has the
table of which game types fold into each, generated from the contract.

## Never pooled without a note

Ask for one mode and you get one game. Ask with no mode and an answer
that mixes modes carries the split beside the number and a note that
starts **Pooled across modes**; when the modes it mixed match players
differently, the note says so and asks for a mode before a row is read
as a strength or a weakness. Your agent is told to repeat that note. The emails
keep modes apart the same way: Your week in the Arena gives a record per
mode, never one record for the week.

One answer pools on purpose: [war deck sets](/docs/war-decks) read a
deck's record over Trophy Road, Path of Legends and Clan Wars together,
because a deck is eight cards whatever the mode, and they keep the split
per mode beside it.

## Events

An event is decided by the event tag the game puts on a battle, not by
its type. A friendly battle with a clanmate stays `casual` even when it
carries an event's tag.

`event` is a filter, not one game: every event has its own rules, so a
rate read over all of them together means little. Read one event at a
time, by its mode name or tag ([how](/docs/battles#events-are-their-own-group-and-they-do-not-inform-the-meta)).
Events never feed the meta: it leaves out every battle that carries an
event tag (a clanmate friendly played under an event's rules included)
and every deck the player did not choose, such as a draft.

## Clan Wars counts games

A war duel is one battle of up to three games, each with its own deck
and result. The duel's own result is the games won, first to two; the
card, meta and war-deck tools count each game on its own. A boat
battle where a rival attacked the clan's boat is not the defending
member's battle, and it stays out of their wins, losses and rates. [Duels and boat battles](/docs/battles#duels-and-boat-battles)
has the detail.

## Asking for one mode

The battle and card tools take `mode`, one group at a time:
`battles_query`, `battles_performance`, `battles_compare`,
`battles_trends`, `battles_decks`, `battles_cards`, `battles_opponents`, `cards_card`,
and `clans_standings`. Ask your agent for "my Path of
Legends this week" and it passes `mode: "ranked"`; the
[glossary](/docs/glossary) has the words people use for each. Omitting
`mode` means every mode, and the note above.

The JSON API's battle list (`GET /players/{tag}/battles`) takes no mode
yet: it returns recent battles across every mode, each row naming its
own.
