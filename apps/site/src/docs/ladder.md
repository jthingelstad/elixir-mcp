---
slug: ladder
title: "Ladder: your season, read back"
description: "Ladder, at /ladder: one of your players' Clash Royale season as Elixir recorded it, one mode at a time, read from the same tools a connected app calls. What each page shows, which tool each number comes from, and what Ladder deliberately leaves out."
section: ladder
order: 1
navTitle: "Ladder"
icon: chart-line
lede: "Your season as the record holds it, one mode at a time: a mirror, not a coach. Every number on it is one a tool returned."
console: ["Open Ladder", "/ladder", "Ladder ▸ Season"]
---

# Ladder: your season, read back

The game forgets: its battle log holds roughly your last 30 battles. Elixir keeps
every battle it records, and **Ladder**, at `/ladder`, reads that record
back to you as a season: what you played, in which mode, and how it went.
It sits beside the Console, signed in like the Console, with its own
menu down the left.

Ladder is a mirror, not a coach. It shows what happened and leaves the
conclusion to you: no verdict, no pace, no advice, and no number the tools
do not return. There is no model behind it; each page is a handful of the
same tool reads a connected app makes, and each one counts against your daily
quota like any other read.

## A player just added

A tag you have just added has nothing on record yet, so Ladder says the
first capture is on its way, on every page, instead of an empty season or a
read error. It holds that until both reads of the first capture are in: the
profile (usually seconds after the add) and the battle log, which brings
roughly the last 30 battles. A player whose battle log is read and empty
is shown as an empty season, not a wait. If Clash Royale has no player with
that tag, Ladder says **Tag not found**, in the Console's words, and **Fix
the tag** opens the player's Tracking page at the place to type the right
one.

## One mode at a time

Each mode is its own game, so each has its own tab, and nothing on a page
pools across them. **Trophy Road** and **Path of Legends** match you by
different rules; a war battle draws its opponent from the clans racing that
week, not from your trophies; an event plays by its own. A win rate across
all of them would describe none of them. [Modes](/docs/modes) says how
Elixir tells them apart.

Days played and Decks show every mode on one page, and they still keep
each mode's mark and record apart. The season home opens on the mode you
played most in the last 30 days, including War and Events. Ties keep the first
tab in the order shown; with no recorded battles, Trophy Road is the default. The tabs are
addresses (`/ladder?mode=ranked`), so a link to one mode stays in it.

## Which season

Ladder opens on the current season, and the **Season** switch beside the
page's freshness offers every season your player has battles in: the
current one, the last one, and each one before it back to the first battle
Elixir recorded. The list comes from the tools, not a calendar: one
[battles_performance](/docs/tools/battles#battles_performance) read from
that first battle, whose `applied.window` names each season the window
crossed. Seasons are named as everywhere else in Elixir, **Season 136**,
and the one running is marked *now*.

The season is part of the address (`/ladder?season=135`), like the mode,
so a link to a past season stays on it, a reload keeps it, and every page
honours it: the season home, Days played, Decks and Cards each read that
season with `season: 135`. A past season's home shows its dates and record
week by week, and links its decks in place of the most-played deck, which
is always the last 30 days. Emails that describe a season link Ladder with
it (see [Emails](/docs/email)).

When the current season has no recorded battles yet (the first days after
the first-Monday roll, in any mode) and your player has a season before
it on record, Ladder opens on last season and says so above the page, with
the empty one a click away. A
season you ask for in the address is always the one shown, even when it is
empty, and a player whose first capture has not landed still sees it on its
way, never last season.

Console's recording summary links a saved profile directly to its dated
profile view, and retained battles directly to the battle browser,
including older seasons. It does not use an empty current season as proof
that those records are missing.

## Whose season

Ladder reads your own players: your primary, and any alt you track as
yours. The player at the top of the menu is whose season you are reading,
and with more than one it opens a list to switch. A friend's or a watched
player's season is not on Ladder; it is theirs. With no player of your own
yet, Ladder sends you to **Tracking** to add the player you play as.

## The season home

The season home is the season so far in the chosen mode (the current one
unless you picked another), from
[battles_performance](/docs/tools/battles#battles_performance) with
`season: current` (or the season's number):

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
  that mode's own; across modes it would pool them. Shown for the running
  season only; a past season links its decks instead.

The season itself runs first Monday to first Monday at 10:00 UTC, which
the page gives in your own timezone, as it gives every time, naming the
zone ("5:00 am CDT"). A new account starts on its signup browser's time
zone; with no time zone set on your account that is UTC, and the page
says so.

Below the season, once your primary player's clan is on record, the page
offers [Bring your clanmates](/docs/bring-your-clan#bring-your-clanmates):
words to invite your clan, the same panel as on Console ▸ Overview.

## Days played

**Days played**, at `/ladder/days`, lays the season on your calendar in
your own timezone, from [battles_query](/docs/tools/battles#battles_query):
the season's battles in compact form, read forty to a page. A page view
reads at most twelve pages, the newest 480 battles; past that, the days it
did not reach are marked "partially read"; any battles already read stay visible.

- **Days with recorded battles**: the days with at least one captured battle,
  today included. The season's elapsed days do not measure capture coverage.
- **A tile for each of the two modes you played most**: the days you
  played it, its battles and its own record.
- **Longest covered quiet stretch**: consecutive whole days before today
  with no recorded battles, only where complete comparable profile intervals
  cover every instant of each day. Missing intervals, partial capture and the
  time since the latest observation remain unknown and break the stretch.
- **The calendar**: one cell a day, each mode with its own mark and
  record, and the day's battles counted in the corner. A battle after
  midnight counts on the next day.
- **Nights**: a night is a run of battles with no gap longer than 30
  minutes, newest first. A night in one mode shows its record; a night
  across modes shows each mode's record where it was played, and never one
  for the night. On Trophy Road it shows the trophies you started and
  ended on, and says so when you ended on the floor. Open a night for its
  battles; a battle opens on its own page when the record has one.

The page checks [capture coverage](/docs/recording#completeness) separately.
A successful poll or a seven-day average does not prove a whole day was captured.
Empty cells show unknown or incomplete capture unless coverage supports a zero;
positive battle records remain visible even when capture is incomplete. Today
and season-clipped days cannot establish a whole quiet day.

A defense of your clan's boat is not your battle, so Days played leaves it
out, as the season home does.

## Decks

**Decks**, at `/ladder/decks`, is every deck you played in the season, each
judged in the mode it was played in, from
[battles_decks](/docs/tools/battles#battles_decks) with `season: current`
(or the season picked):
one read over every mode to learn which modes you played, then one read per
mode, so a deck you took from Trophy Road into an event has a record in
each and never one across them. A deck is its exact cards, forms and tower
troop, so the same eight cards with an evolution moved are two decks, and a
war deck (which has no tower troop) is its own row.

- **Trophy Road and Path of Legends**: a section each, headed by the mode's
  season record from battles_performance. Each deck shows its archetype
  label, its evolutions and hero forms, the days you first and last played
  it, its average elixir, its eight cards, its battles, record and win rate
  in that mode, and its mean level gap: how many levels your cards sat
  above or below your opponents', on average. A deck's cards are one read
  each, so a mode shows the six decks played most until you ask for all.
- **A swap of forms**: when two decks of one mode are the same eight cards
  with a form moved, and you put the first down before you picked the
  second up, the page draws the swap: the forms before and after, the
  cards that did not change, and each deck's own record. It reads back
  what happened after the change; it does not say the change caused it.
- **War, duels and events**: every other mode's decks as rows of one
  table, each with that mode's record, its forms, its level gap and a note
  when it is the same cards as a Trophy Road deck. A duel has no single
  deck, so its rows are the decks you played in its rounds, each round won
  or lost on its own crowns.

## Cards

**Cards**, at `/ladder/cards`, is one mode's season card by card, with
the same mode tabs as the season home. An evolution or a hero is a
different card from its base form, so each keeps its own row, as the tools
keep it. Each card's name opens its public page, which holds the card's
catalog facts: rarity, elixir cost and forms.

- **Your cards**: from [battles_cards](/docs/tools/battles#battles_cards)
  with `perspective: mine`: for each card and form, the battles where your
  deck held it, your record in them and the share you won. A card in more
  than one deck carries all of their battles, so the rows overlap and
  never add up. The tool leaves out cards played in fewer than three
  battles, and the page says so.
- **Across the table from you**: the same tool with
  `perspective: opponent`: each card your opponents played, how many
  battles you faced it in, your record in those battles, and the level
  gap: your deck's average card level minus your opponent's in those
  battles, on the game's level scale, or a dash where the record has no
  levels. The longest lists show twelve rows until you ask for all.
- **Opponents**: from
  [battles_opponents](/docs/tools/battles#battles_opponents): how many
  different players you met in the mode this season, and each one you met
  more than once, with your record against them and the level gap where
  the record has it.
- **Order what you faced**: the cards across the table and the opponents
  you met again read most battles first. **Most losses** is a choice you
  make, never the page's default: it asks the same tools for
  `sort: "losses"`, the most battles you lost first and, at equal losses,
  the most battles. A card is listed only from three battles and a player
  from two meetings, and the page says so beside the choice, so a single
  loss does not lead the list. The order is part of the address
  (`/ladder/cards?order=losses`), and the mode tabs and the season switch
  keep it. It puts no label on any row: the record, in the order you
  asked for.

## What Ladder leaves out

- **A verdict.** Nothing on Ladder rates you, projects a pace ("at this
  rate, Arena 20 by Friday") or suggests a change. A record is evidence;
  what it means is yours to say.
- **When you play.** The nights on Days played say when you played, and
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
