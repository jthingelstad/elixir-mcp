---
slug: activity
title: "Battle activity: a year of days and a weekly rhythm"
description: "The battle-activity graphic on each player you track: a year of UTC days and a 24-by-7 rhythm rebuilt nightly from the record, what a not-recorded day means and why it is never drawn as zero, how the decayed histogram is computed, and what it will drive next."
section: using
order: 18
navTitle: "Battle activity"
icon: calendar-days
lede: "Every player you track shows a year of days and the hours they play, drawn from what Elixir recorded, with the days it was not watching marked as exactly that."
console: ["See it on a player you track", "/account/tracking", "Console ▸ Tracking ▸ a player"]
---

# Battle activity: a year of days and a weekly rhythm

Open a player under **Console ▸ Tracking** and the record of that player
ends with a graphic in two parts: a year of days, one cell per UTC day
coloured by how many battles were recorded, and a rhythm tile, twenty-four
hours by seven weekdays, showing when that player plays. Both are drawn
from the battles already in the record; nothing is read from the game to
draw them.

## What is drawn

**The year.** One cell per UTC calendar day for the last 365 days, weeks
in columns and Monday at the top, newest on the right. The colour is one
hue in four steps, scaled to that player's own busiest day, so a player
who plays five battles on a good evening reads as clearly as one who
plays fifty. Tap or focus a cell and the day's count is written under the
graphic; the list beneath it holds the last two weeks as a table.

**The rhythm.** Every recorded battle in the window lands in one of 168
cells, its weekday and hour. The tile is rotated into your device's clock
and says which offset it used. Recent weeks count for more than old ones
(see below), so a player whose evenings moved is read from where they play
now.

Days are UTC because the record is (the game's own day and war reset are
UTC too). The rhythm is shown in your clock because "when do they play" is
a question about a person.

## Not recorded is not zero

A hatched cell is a day the record does not cover. It is drawn distinctly
from a quiet day on purpose: a blank day for a player Elixir was not yet
recording would say "did not play", and that is not known. Three cases
are marked:

- **Before recording began.** Every day before the first recording of
  that player. Battles may still show on such a day, recorded from another
  player's log as an appearance; the cell stays hatched and the count is
  given in its label, because an appearance is not coverage.
- **A capture-audit gap.** The UTC day on which a battle-log read found
  the log had rolled past the newest battle already recorded, so whatever
  came before the log's oldest entry was never seen. The Status page
  publishes the same audit as a count.
- **An incomplete coverage interval.** Every UTC day inside a pair of
  daily profile snapshots whose lifetime battle counter moved more than
  the battles recorded between them, the rule `elixir_coverage` uses for
  its completeness estimate (see [Completeness](/docs/recording#completeness)).
  The lifetime counter includes some modes the log never shows, so this
  marks generously.

Everything else is a recorded day, and zero there means Elixir was
watching and no battle was played.

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
