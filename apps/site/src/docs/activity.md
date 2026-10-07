---
slug: activity
title: "Battle activity: a year of days"
description: "A year of recorded battles by UTC day. Complete comparable observations can establish a quiet day; missing or incomplete capture stays unknown."
section: record
order: 7
navTitle: "Coverage"
icon: calendar-days
lede: "Recorded battles stay visible. Empty days need complete capture before they can mean quiet."
console: ["See yours on the Overview", "/console/account", "Console ▸ Overview"]
---

# Battle activity: a year of days

The first thing on **Console ▸ Overview** is your battle activity, with a
chip per tracked player to switch between them; each player's own record
under **Tracking** carries the same graphic beside its capture details:
a year of days, one cell per UTC day coloured by how the day went and
shaded by how much was played, drawn from the battles already in the
record; nothing is read from the game to draw it.

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
as a table. On a phone, capture labels wrap so the date, recorded count and
win/loss result stay together within the page.

Days in the year graphic are UTC calendar days (midnight to midnight), not
the 10:00 UTC game days the series tools and the war grid use. The graphic
reads canonical battle rows by their UTC date, which is the day a
person reads off a calendar; the game day exists to line battles up with the
season and war clock, and a graphic of "did they play on the 12th" is not a
war question. A late-night session (after 10:00 UTC, before midnight) is one
cell here and one game day in `players_timeline`; a session between midnight
and 10:00 UTC is the next cell here and still the previous game day there.

## Missing capture is not zero

A day with battles in the record always shows that positive activity, including
battles imported on tracking or seen in another player's log. It says how many
battles were recorded and whether that day's capture is complete, incomplete or
unknown. A positive count alone does not establish complete capture.

An empty day means **covered quiet day** only when complete, comparable profile
observation intervals cover the whole closed UTC day without gaps. The intervals
compare the change in the profile's lifetime battle counter with canonical
battles recorded between the observations: the same evidence contract as
[Completeness](/docs/recording#completeness). Counter resets, missing counters,
more recorded battles than the counter explains, or unmatched counter increases
cannot establish completeness. The counter includes some modes the battle log
may not show; an unmatched increase is incomplete evidence, not proof of a
missing particular battle.

Other empty days are hatched: **capture incomplete or unknown**, never an
inactive day or a break from play. A successful battle-log read, a tracking start
date or a freshness stamp cannot prove a quiet day. Today's UTC day is still
open, so its complete-day capture is not established. Tap a cell for its dated
reading; the list beneath the year names the same capture state without colour.

## How it is read

The window is the last 365 UTC dates through today. Its canonical battle counts
and observation intervals are read together from one database snapshot, so late
arrivals repair the count and interval together. Missing nightly metadata does
not delay the graphic, and stale metadata cannot truncate newer activity. No
request to the game is needed. The evidence-read timestamp dates the graphic;
“tracked since” is account context and does not establish coverage.

The nightly activity job still maintains descriptive metadata and historical
capture-audit marks. Those cached marks and poll-success receipts do not decide
which empty days are quiet in this graphic. No older capture is manufactured or
backfilled by viewing the year, and no first-capture arrival time is promised.
Retired automatic groups do not generate activity records. A personal follow
still works when the account appeared in an old group.

## What became of the rhythm

Until 2026-09-19 the graphic carried a second tile, twenty-four hours by
seven weekdays, built as a decayed histogram of when the player played.
It was step one of an adaptive polling design in which the recorder
would place each battle-log read where the player's expected battles
crossed the log's batch. Scored against a week of reads it did not: the
population plays in sittings that land in hours the histogram rated
ordinary, and no placement it produced cut empty reads without raising
lost battles. The recorder runs [the session
clock](/docs/recording#how-often-a-subject-is-fetched) instead, and the
tile came down with the design; the year is the product.
