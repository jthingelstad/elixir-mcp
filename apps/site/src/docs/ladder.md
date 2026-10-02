---
slug: ladder
title: "Ladder: your season, read back"
description: "Ladder, at /ladder: one of your players' Clash Royale season as Elixir recorded it, one mode at a time, read from the same tools an agent calls. What each page shows, which tool each number comes from, and what Ladder deliberately leaves out."
section: ladder
order: 1
navTitle: "Ladder"
icon: chart-line
lede: "Your season as the record holds it, one mode at a time: a mirror, not a coach. Every number on it is one a tool returned."
console: ["Open Ladder", "/ladder", "Ladder ▸ Season"]
---

# Ladder: your season, read back

The game forgets: its battle log holds your last 25 battles. Elixir keeps
every battle it records, and **Ladder**, at `/ladder`, reads that record
back to you as a season: what you played, in which mode, and how it went.
It is a section of the console, signed in like the rest of it, with its
own menu down the left.

Ladder is a mirror, not a coach. It shows what happened and leaves the
conclusion to you: no verdict, no pace, no advice, and no number the tools
do not return. There is no model behind it; each page is a handful of the
same tool reads an agent makes, and each one counts against your daily
quota like any other read.

## One mode at a time

Each mode is its own game, so each has its own tab, and nothing on a page
pools across them. **Trophy Road** and **Path of Legends** match you by
different rules; a war battle draws its opponent from the clans racing that
week, not from your trophies; an event plays by its own. A win rate across
all of them would describe none of them.

A page opens on the mode you played most: Path of Legends when your last 30
days hold more of it than Trophy Road, otherwise Trophy Road. The tabs are
addresses (`/ladder?mode=ranked`), so a link to one mode stays in it.

## Whose season

Ladder reads your own players: your primary, and any alt you track as
yours. The player at the top of the menu is whose season you are reading,
and with more than one it opens a list to switch. A friend's or a watched
player's season is not on Ladder; it is theirs. With no player of your own
yet, Ladder sends you to **Tracking** to add the player you play as.

## The season home

The season home is the current season so far in the chosen mode, from
[battles_performance](/docs/tools/battles#battles_performance) with
`season: current`:

- **Battles, record and win rate**: the tool's own counts, with the rate as
  it defines it (wins over decided battles, draws outside both sides).
- **Trophy range**: the lowest and highest trophies you landed on after a
  Trophy Road battle. Where the tool returns no range, a trophy mode shows
  net trophies, and war or events show crowns for and against, because
  trophies do not move there.
- **The floor**: when you stood on an arena floor, losses there cost
  nothing, so net trophies say more about how recently you played than how
  well. The page says where you stood and how many losses it absorbed.
- **Week by week**: the same tool with `group_by: week`, wins up and
  losses down, one column per ISO week. A week the season clips is marked
  partial and compares by its win rate, never by its count.
- **Most-played deck**: from [players_summary](/docs/tools/players#players_summary),
  the deck you played most in the last 30 days in any mode, its archetype
  label and average elixir, and its record in each mode it was played in.
  A rate appears only when the deck was played in one mode, where it is
  that mode's own; across modes it would pool them.

The season itself runs first Monday to first Monday at 10:00 UTC, which
the page gives in your own timezone, as it gives every time.

## What Ladder leaves out

- **A verdict.** Nothing on Ladder rates you, projects a pace ("at this
  rate, Arena 20 by Friday") or suggests a change. A record is evidence;
  what it means is yours to say.
- **When you play.** The hour-of-day rhythm tile was removed from the
  console by decision, and Ladder follows it.
- **Matchup expectations.** How you should do against a deck is a judgment
  Elixir does not make; what happened against it is on the record.
