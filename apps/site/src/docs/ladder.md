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
all of them would describe none of them. [Modes](/docs/modes) says how
Elixir tells them apart.

Days played and Decks show every mode on one page, and they still keep
each mode's mark and record apart. The season home opens on the mode you
played most: Path of Legends when your last 30
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

## Days played

**Days played**, at `/ladder/days`, lays the season on your calendar in
your own timezone, from [battles_query](/docs/tools/battles#battles_query):
the season's battles in compact form, read fifty to a page. A page view
reads at most twelve pages, the newest 600 battles; past that, the days it
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

**Decks**, at `/ladder/decks`, is every deck you played this season, each
judged in the mode it was played in, from
[battles_decks](/docs/tools/battles#battles_decks) with `season: current`:
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
keep it. Each card's name opens its public page, where the card's record
across everyone Elixir records lives.

- **Your cards**: from [battles_cards](/docs/tools/battles#battles_cards)
  with `perspective: mine`: for each card and form, the battles where your
  deck held it, your record in them and the share you won. A card in more
  than one deck carries all of their battles, so the rows overlap and
  never add up. The tool leaves out cards played in fewer than three
  battles, and the page says so.
- **Across the table from you**: the same tool with
  `perspective: opponent`: each card your opponents played, how many
  battles you faced it in, and your record in those battles. The longest
  lists show twelve rows until you ask for all.
- **Opponents**: from
  [battles_opponents](/docs/tools/battles#battles_opponents): how many
  different players you met in the mode this season, and each one you met
  more than once, with your record against them.

## What Ladder leaves out

- **A verdict.** Nothing on Ladder rates you, projects a pace ("at this
  rate, Arena 20 by Friday") or suggests a change. A record is evidence;
  what it means is yours to say.
- **When you play.** The hour-of-day rhythm tile was removed from the
  console by decision, and Days played follows it: the nights say when you
  played, and no chart sums them into a habit.
- **Comparing two decks.** The board's "Compare two decks" has no page
  yet; each deck's record sits in its own row, and a comparison across
  rows is only fair within one mode and a similar level gap.
- **How everyone plays a card.** The card tables show your battles only;
  how often everyone recorded plays a card is on the card's public page,
  one click away, and is not copied into a column here.
- **Matchup expectations.** How you should do against a deck is a judgment
  Elixir does not make; what happened against it is on the record.
