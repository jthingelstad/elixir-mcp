---
slug: ladder-season
title: "Ladder season"
description: "The Season tab in Ladder: your record, the week against your last four, before and since your main deck, and this season against the last."
section: ladder
order: 2
navTitle: "Season"
icon: chart-line
lede: "The season so far in the chosen mode."
guide: ladder
---

# Season

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
- **Days played**: the calendar, [below](/docs/ladder-battles#days-played).
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
[Which season](/docs/ladder#which-season)). If your record began partway through it,
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
offers [Invite clanmates](/docs/bring-your-clan#bring-your-clanmates):
words to invite your clan.
