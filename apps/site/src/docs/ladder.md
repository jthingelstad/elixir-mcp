---
slug: ladder
title: "Ladder: your season, read back"
description: "Ladder, at /ladder: one of your players' Clash Royale season as Elixir recorded it, one mode at a time, read from the same tools a connected app calls. What each page shows, which tool each number comes from, and what Ladder deliberately leaves out."
section: ladder
order: 1
navTitle: "Reading your Ladder"
icon: chart-line
lede: "Your season as the record holds it, one mode at a time: a mirror, not a coach. Every number on it is one a tool returned."
guide: ladder
callout: ["Open it at Ladder › Season", "/ladder", "Open Ladder"]
---

# Ladder: your season, read back

The game forgets: its battle log holds roughly your last 30 battles. Elixir keeps
every battle it records, and **Ladder**, at `/ladder`, reads that record
back to you as a season: what you played, in which mode, and how it went.
Reach it from **You** (the account menu on a wide screen, a tab on a phone)
or from a player's page; it is signed in like Home. A bar at the top says whose
season, which season and which mode you are reading; four tabs under it are
the pages: **Season**, **Battles**, **Decks** and **Cards**.

Ladder is a mirror, not a coach. It shows what happened and leaves the
conclusion to you: no verdict, no pace, no advice, and no number the tools
do not return. There is no model behind it; each page is a handful of the
same tool reads a connected app makes. They are your own reads of your own
record, so they never count against your daily tool-call quota; they share
only the hourly limit of 300 calls with your own connected apps, and Usage
lists them apart from the budget ([Limits](/docs/limits)).

## A player just added

A tag you have just added has nothing on record yet, so Ladder says the
first read is on its way, on every page, instead of an empty season or a
read error. It holds that until both reads of the first read are in: the
profile (usually seconds after the add) and the battle log, which brings
roughly the last 30 battles. A player whose battle log is read and empty
is shown as an empty season, not a wait. If Clash Royale has no player with
that tag, Ladder says **Tag not found**, in the words Settings uses, and **Fix
the tag** opens the player's page in Settings at the place to type the right
one. A tag given at signup is just added in the same way. The player list stays
at the top of both, so you can switch back to a player already on record.

## One mode at a time

Each mode is its own game, so each has its own chip in the bar, and nothing on a
page pools across them. **Trophy Road** and **Path of Legends** match you by
different rules; a war battle draws its opponent from the clans racing that
week, not from your trophies; an event plays by its own. A win rate across
all of them would describe none of them. [Modes](/docs/modes) says how
Elixir tells them apart.

There are five chips: Trophy Road, Path of Legends, War, Events and Casual.
A sixth, **Other**, appears only when your season holds a Challenge or a
Tournament battle. It shows the two apart, one panel each, because a Tournament
is not a Challenge; they are never added up.

The chip sticks as you move between tabs. Ladder opens on the mode you played
most in the last 30 days, ties keeping the order of the chips; with no recorded battles,
Trophy Road is the default. The mode is part of the address
(`/ladder/decks?mode=war`), so a link to one mode stays in it.

On War, every tab says this week's decks and points for your clan's race, as
the clan's record holds them, and links to the race in Clan. A duel spends one
deck a round, so decks and battles differ. Where the game has not drawn the
season's races yet, the line says so, and where the race cannot be read there
is no line.

## Which season

Ladder opens on the current season, and the **Season** list in the bar
offers every season your player has battles in: the
current one, the last one, and each one before it back to the first battle
Elixir recorded. The list comes from the tools, not a calendar: one
[battles_performance](/docs/tools/battles#battles_performance) read from
that first battle, whose `applied.window` names each season the window
crossed. Seasons are named as everywhere else in Elixir, **Season 136**,
and the one running is marked *now*.

The season is part of the address (`/ladder?season=135`), like the mode,
so a link to a past season stays on it, a reload keeps it, and every page
honours it: Season, Battles, Decks and Cards each read that season with
`season: 135`. Emails that describe a season link Ladder with
it (see [Emails](/docs/email)).

When the current season has no recorded battles yet (the first days after
the first-Monday roll, in any mode) and your player has a season before
it on record, Ladder opens on last season and says so above the page, with
the empty one a click away. A
season you ask for in the address is always the one shown, even when it is
empty, and a player whose first read has not landed still sees it on its
way, never last season.

A player's record under Settings › Players & tracking links a saved profile directly to its dated
profile view, and retained battles directly to the battle browser,
including older seasons. It does not use an empty current season as proof
that those records are missing.

## Whose season

Ladder reads your own players: your primary, and any alt you track as
yours. The first thing in the bar is whose season you are reading: a name and
a tag with one player, a list to switch with more than one. A friend's or a
watched player's season is not on Ladder; it is theirs. With no player of your
own yet, Ladder offers **Add your player**.

Beside the chips, a small chip says when this player's battle log was last read.
Open it for what that means: the game keeps about the last 30 battles, so a long
session between reads can leave a gap, and a gap means unknown, not no battles.

## What Ladder leaves out

- **A verdict.** Nothing on Ladder rates you, projects a pace ("at this
  rate, Arena 20 by Friday") or suggests a change. A record is evidence;
  what it means is yours to say.
- **When you play.** The sittings on Battles say when you played, and
  no chart sums them into an hour-of-day habit.
- **Comparing two decks.** There is no deck-against-deck page; each deck's
  record sits in its own row, and a comparison across rows is only fair
  within one mode and a similar level gap.
- **How everyone plays a card.** The card tables show your battles only.
  Elixir keeps no cross-player card statistics; a card's public page holds
  its catalog facts.
- **Matchup expectations.** How you should do against a deck is a judgment
  Elixir does not make; what happened against it is on the record.
- **A label for what beats you.** Most losses first is an order, not a
  verdict: no card or player is called anything, and no row says what to
  do about it.
