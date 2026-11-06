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
It sits beside Home, signed in like Home. A bar at the top says whose
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
one. A tag given at signup is just added in the same way: the new account
opens on the player's page while the first read comes in. The player list stays
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
most this season, ties keeping the order of the chips; with no recorded battles,
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

A player's record under Settings ▸ Players links a saved profile directly to its dated
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

## The Season tab

The Season tab is the season so far in the chosen mode (the current one
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
- **Days played**: the calendar, [below](#days-played).
- **Week by week**: the same tool with `group_by: week`, each week's record as
  a bar of wins and losses, newest first. A week the season clips is marked
  part of a week.
- **Most played deck**: from [battles_decks](/docs/tools/battles#battles_decks),
  the deck you played most in this mode and this season, in its real cards, with
  its archetype label, its record and its average elixir. Under it, a link to
  every deck you played.

While your record is young (recorded for under 28 days, counted from
the start of recording the tools report), the Season tab also says
**Your record is N days old** and offers one next step: **Verify your
player** if it is not verified; **Open Clan** if it is verified and its
clan is recorded; otherwise **Follow a friend**. It is a link, not advice
about play, and it is gone from day 28.

The season itself runs first Monday to first Monday at 10:00 UTC, which
the page gives in your own timezone, as it gives every time, naming the
zone ("5:00 am CDT"). A new account starts on its signup browser's time
zone; with no time zone set on your account that is UTC, and the page
says so.

### This week vs your last 4

In the current season, the Season tab sets the game week so far beside
the four whole game weeks before it, in the chosen mode only. A game week
runs Monday 10:00 UTC to Monday 10:00 UTC, the week the Arena email
reports; the page names when this one began in your own timezone. It is
one [battles_performance](/docs/tools/battles#battles_performance) read,
the week as its window and the four before as `compare_from`/`compare_to`,
and it shows three of the tool's own numbers, each with the battles it is
over:

- **Win rate**, over decided battles (draws outside both sides).
- **Three-crown rate**, over head-to-head battles (duel rounds and boat
  battles left out, as the tool leaves them out).
- **Net trophies**, in Trophy Road and Path of Legends only, where
  trophies move; over the mode's battles.

A side needs at least **10 battles** before it is set beside the other.
Below that for the win rate, the strip is not drawn at all; below it for
one number, that number is left off both sides, so each row compares like
with like. The four weeks before can reach into the previous season: the
weeks are the game's, not the season's.

### Before and since your main deck

When the deck you played most this season in the chosen mode (a deck is
its exact cards, as on Decks) arrived after you had played others, the
Season tab splits the season at its first battle and shows the same three
numbers before and since, from one battles_performance read with
`before_after`. The deck is named by its archetype label, and the page
names the deck you played most before it. Both sides count every deck you
played in the mode, so the split is a moment in your season, not a
deck-against-deck comparison. The same 10-battle minimum holds on each
side. It reads back what happened after the change; it does not say the
change caused it.

### This season vs last

The Season tab sets the season you are reading beside the one before it
on your record, in the chosen mode only. Each side shows the tool's own
numbers, each with the battles it is over:

- **Won–lost**, over the side's battles.
- **Win rate**, over decided battles.
- **Net trophies**, in Trophy Road and Path of Legends only.
- **Decks played**: how many different decks (a deck is its exact cards,
  as on Decks) you played. In war a duel has no single deck and is not
  counted.

A season still running is **so far**. It sits beside last season to the
same point, as far into it to the hour as this season is when you open
the page, and beside all of last season. In a season's first hour there
is no same point yet, and the page says so. Once this season has run as
long as last season did, all of last season is the same point and stands
alone. A past season, such as `?season=136`, sits beside the season
before it, both whole. Seasons differ in length, so the page says how
long each ran.

The season before is the next one down in your record's list (see
[Which season](#which-season)). If your record began partway through it,
the page says so, because not all of that season is on record. The same
10-battle minimum holds: a side with fewer than 10 decided battles is not
set beside another, and the page says which. Last season to the same
point drops out on its own, leaving all of last season. When your record
holds no season before the one you are reading, or last season has no
battles in the mode, the page says that in a sentence.

It reads last season with one battles_performance read (the season, with
the same point as `compare_from`/`compare_to`) and, for each of its sides
it shows, one [battles_decks](/docs/tools/battles#battles_decks) read for
`total_decks`; the read of last season's decks is the Decks page's own.
This season's side is the Season tab's own reads. Under the minimum,
none of these is made. The panel says nothing about why the two seasons
differ.

No panel says which side is better: no arrow, colour, score or word
leans either way. The numbers are the tool's, and so is the conclusion
yours.

Below the season, once your primary player's clan is on record, the page
offers [Bring your clanmates](/docs/bring-your-clan#bring-your-clanmates):
words to invite your clan, the same panel as on Home.

## Days played

The calendar on the Season tab lays the season on your calendar in your own
timezone, from [battles_query](/docs/tools/battles#battles_query): the season's
battles in compact form, read forty to a page, the newest 480 at most. The same
read serves every chip.

Each day shows its count in the chosen mode, shaded by how many, and the key
under the calendar says what each shade means. A day with battles only in other
modes shows that count, never pooled into this one. Today has a ring, and days
to come say nothing. A battle after midnight counts on the next day.

Empty days are the careful part. The page checks
[capture coverage](/docs/recording#completeness) separately, because a
successful read or a seven-day average does not prove a whole day was captured:

- **No battles**: the whole day was read, across every mode.
- **Partly read**: some of the day was read, so it may still hold battles.
- **Unknown**: no read covers this day.

If coverage cannot be checked, the page says so and no day is called empty. Past
the 480 battles, older days are marked not read and the battles already read
stay visible. **Longest stretch with no battles** counts only whole days fully
read; missing, partial and today's days end the stretch. On a phone the calendar
is a list of the days, newest first.

## Battles

**Battles**, at `/ladder/battles`, lists the season's battles in the chosen
mode, newest first: a panel for each day, headed by its count and record, and
under it each sitting, a run of battles with no gap longer than 30 minutes. A
sitting that crosses midnight splits, so a day's panel matches its day on the
calendar. A sitting shows its times, its record and, on Trophy Road, the
trophies you started and ended on. Open it for its battles; a battle opens on its
own page when the record has one. The page reads this mode's battles only, and
shows seven days until you ask for older ones. On **Other**, Challenge and
Tournament each have their own days and sittings, so no count or record crosses
the two.

War battles are listed like any other, each on the day you played it: Ladder
shows your battles one by one. Elixir shows war by the week where it is about
your clan's war, such as the decks a member used in a race week, as the line at
the top says.

A defense of your clan's boat is not your battle, so Battles leaves it out, as
the Season tab does.

The old address, `/ladder/days`, lands here with its player, mode and season.

## Decks

**Decks**, at `/ladder/decks`, is every deck you played in the season in the
chosen mode, most played first, from
[battles_decks](/docs/tools/battles#battles_decks) with that one `mode` and the
season: one read for the list and one per deck for its cards, so a deck you took
from Trophy Road into an event has a record on each chip and never one across
them. A deck is its exact cards, forms and tower troop, so the same eight cards
with an evolution moved are two decks, and a war deck (which has no tower troop)
is its own row.

- **Every chip**: each deck shows its archetype label, its evolutions and hero
  forms, the days you first and last played it, its average elixir, its eight
  cards in their real art, its battles, record and win rate, and how many levels
  your cards sat above or below your opponents', on average.
- **A swap of forms**: when two decks of one mode are the same eight cards
  with a form moved, and you put the first down before you picked the
  second up, the page draws the swap: the forms before and after, the
  cards that did not change, and each deck's own record. It reads back
  what happened after the change; it does not say the change caused it.
- **Duel rounds**: on War, a duel has no single deck, so the decks you played in
  its rounds have a panel of their own, each round won or lost on its own crowns.

## Cards

**Cards**, at `/ladder/cards`, is one mode's season card by card, with
the same chips as every tab. An evolution or a hero is a
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
  (`/ladder/cards?order=losses`), and the chips and the Season list
  keep it. It puts no label on any row: the record, in the order you
  asked for.

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
