---
slug: activity
title: "Battle activity: a year of days and a weekly rhythm"
description: "The battle-activity graphic on each player you track: a year of UTC days and a 24-by-7 rhythm rebuilt nightly from the record, what a not-recorded day means and why it is never drawn as zero, how the decayed histogram is computed, and what it will drive next."
section: using
order: 18
navTitle: "Battle activity"
icon: calendar-days
lede: "Every player you track shows a year of days and the hours they play, drawn from what Elixir recorded, with the days it was not watching marked as exactly that."
console: ["See yours on the Overview", "/account", "Console ▸ Overview"]
---

# Battle activity: a year of days and a weekly rhythm

The first thing on **Console ▸ Overview** is your battle activity, with a
chip per tracked player to switch between them; each player's own record
under **Tracking** carries the same graphic beside its capture details.
It has two parts: a year of days, one cell per UTC day
coloured by how the day went and shaded by how much was played, and a
rhythm tile, twenty-four hours by seven weekdays, showing when that
player plays. Both are drawn
from the battles already in the record; nothing is read from the game to
draw them.

## What is drawn

**The year.** One cell per UTC calendar day for the last 365 days, weeks
in columns and Monday at the top, newest on the right. A cell carries two
things. Its hue is the day's win share: all losses is red, all wins is
blue, and an even day sits between. Its shade is the volume, four steps
scaled to that player's own busiest day, so a player who plays five
battles on a good evening reads as clearly as one who plays fifty. Draws
and battles without a resolved result count toward the volume and toward
neither side of the share; a day with no decided battle at all keeps the
neutral purple. Tap or focus a cell and the day's count and record are
written under the graphic; the list beneath it holds the last two weeks
as a table.

**The rhythm.** Every recorded battle in the window lands in one of 168
cells, its weekday and hour. The tile is rotated into your device's clock
and says which offset it used. Recent weeks count for more than old ones
(see below), so a player whose evenings moved is read from where they play
now.

Days in the year graphic are UTC calendar days (midnight to midnight), not
the 10:00 UTC game days the series tools and the war grid use. The graphic
is rebuilt nightly from the battle rows by their UTC date, which is the day a
person reads off a calendar; the game day exists to line battles up with the
season and war clock, and a graphic of "did they play on the 12th" is not a
war question. A late-night session (after 10:00 UTC, before midnight) is one
cell here and one game day in `players_timeline`; a session between midnight
and 10:00 UTC is the next cell here and still the previous game day there.
The rhythm is shown in your clock because "when do they play" is a question
about a person.

## Not recorded is not zero

A day with battles in the record is always drawn with its count, whichever
way the battles arrived: live reads, history imported when the player was
added, or appearances in other players' logs. The question the colour has
to answer is only what an empty day means, and the record itself answers
it: Elixir was watching a player on a day when it admitted a read of that
player's battle log on the day or within the two days after it (a log
holds about 25 battles, so a read that soon still saw the day). An empty
day inside that coverage is zero. An empty day outside it is hatched,
"not recorded", because nobody was looking and nothing is known. When you
started tracking the player colours nothing; the legend names both dates,
"log read since" and "tracked since".

Two marks from the recorder narrow coverage further:

- **A capture-audit gap.** The UTC day on which a battle-log read found
  the log had rolled past the newest battle already recorded, so whatever
  came before the log's oldest entry was never seen. The Status page
  publishes the same audit as a count. Battles recorded on such a day are
  drawn and labelled "log rolled past some".
- **An incomplete coverage interval.** Every UTC day inside a pair of
  daily profile snapshots whose lifetime battle counter moved more than
  the battles recorded between them, the rule `elixir_coverage` uses for
  its completeness estimate (see [Completeness](/docs/recording#completeness)).
  The lifetime counter includes some modes the log never shows, so this
  marks generously.

The rhythm tile has no such distinction to make: it is built from every
recorded battle in the window, and its header says how many that is.

## How it is computed

A nightly job (05:30 UTC) rebuilds one row per recorded player from the
battle record: the daily counts, and the rhythm as a decayed histogram in
which each battle adds `2^(-age in days / 28)` to its weekday-hour cell.
A battle four weeks old counts half, eight weeks old a quarter. The row is
a projection, rebuilt in full every night, never a system of record, and
a player added today has a graphic after the next run.

## What it is for next

The same histogram is step one of adaptive polling. Today every player's
battle log is read on a yield schedule; once a week of histograms has
been compared with the capture audit, the scheduler will place each log
read where the player's expected battles cross the log's batch, using the
fleet-wide rhythm as the starting point for a player with fewer than
twenty battles. That change is not made yet, and the graphic does not
change when it is.
