---
slug: ladder-battles
title: "Stats battles"
description: "The Battles tab in Stats: each day played, and every recorded battle with its deck, opponent and result."
section: ladder
order: 3
navTitle: "Battles"
icon: swords
lede: "Every recorded battle in the season, by the day it was played."
guide: ladder
---

# Battles

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
[recording coverage](/docs/freshness-and-gaps#completeness) separately, because a
successful read or a seven-day average does not prove a whole day was recorded:

- **No battles**: the whole day was read, across every mode.
- **Partly read**: some of the day was read, so it may still hold battles.
- **Unknown**: no read covers this day.

If coverage cannot be checked, the page says so and no day is called empty. Past
the 480 battles, older days are marked not read and the battles already read
stay visible. **Longest stretch with no battles** counts only whole days fully
read; missing, partial and today's days end the stretch. On a phone the calendar
is a list of the days, newest first.

## Battles

**Battles**, at `/home/you/stats/battles`, lists the season's battles in the chosen
mode, newest first: a panel for each day, headed by its count and record, and
under it each sitting, a run of battles with no gap longer than 30 minutes. A
sitting that crosses midnight splits, so a day's panel matches its day on the
calendar. A sitting shows its times, its record and, on Trophy Road, the
trophies you started and ended on. Open it for its battles; a battle opens on its
own page when the record has one. The page reads this mode's battles only, and
shows seven days until you ask for older ones. On **Other**, Challenge and
Tournament each have their own days and sittings, so no count or record crosses
the two.

War battles are listed like any other, each on the day you played it: Stats
shows your battles one by one. Elixir shows war by the week where it is about
your clan's war, such as the decks a member used in a race week, as the line at
the top says.

A defense of your clan's boat is not your battle, so Battles leaves it out, as
the Season tab does.
