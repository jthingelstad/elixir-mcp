---
slug: clocks
title: "Time and clocks"
description: "The three timestamps a response can carry (computed, observed, played) and which one freshness reads; the 10:00 UTC policy day every clan shares and the war-day, week, section, season and Colosseum vocabulary built on it; and how from/to windows, date-only bounds, days and weeks sugar and the timezone argument resolve on every windowed tool."
section: record
order: 19
navTitle: "Time & clocks"
icon: clock
lede: "Computed, observed and played are three different times. Which one a field means, and what day it is in the game."
---

# Time and clocks

Storage is UTC everywhere; timezone is a display concern. That one rule
produces three different timestamps on most responses, a policy calendar the
game itself does not publish, and a small set of window conventions every
tool shares. This page holds all three so no tool has to explain them.

## Computed, observed, played

A response can carry three kinds of time, and they answer different questions:

| Time | Field | Question it answers |
|---|---|---|
| computed | `meta.as_of` | when the sums were done. It is now, at the moment of the call, and says nothing about the data's age |
| observed | `meta.source_polls.<endpoint>.observed_at` | when the recorder last **admitted** a payload from that source (profile, battle log, clan, current race) |
| played | `battle_time` | when the battle happened, from the battle log's own stamp. Every battle window filters on this, never on when the battle was captured |

`meta.freshness_seconds` is the age at `as_of` of the **oldest relevant**
poll, not the newest poll of any kind: a fresh profile must never disguise a
stale battle log. It is `null` when any required source has never been polled,
because unknown is not zero-age evidence. `recorded_since` is the earliest
stored history for the subject, which can predate anyone tracking it (an
opponent's log, an import); `recording_active_since` is when the current
recording began. The two are kept apart because history is never deleted when
a recording stops. The fields are defined on
[Reading a response](/docs/responses#the-fields).

Daily snapshots are keyed by **UTC date**: `players_timeline` returns one
point per snapshot day and only from `snapshots_available_from`, and
`players_summary.trophies_as_of` is a date, not an instant, because it names
the snapshot the trophy count came from. Snapshot-series tools take
`YYYY-MM-DD` bounds only; an instant is refused.

Events carry `created_at`, the moment the recorder noticed the change, which
is "observed between two polls": a member who left at 09:05 and was noticed
at 09:15 has an event stamped 09:15.

## The policy day

Clash Royale does not publish a calendar. The river race resets once a day
and the reset **drifts per clan**: matchmaking assigns each clan's race a
start that wanders from the nominal hour, and the drift is different for every
clan. Elixir MCP therefore keeps one **policy day** for every clan: the day
rolls at **10:00 UTC**, the same hour the season rolls, and the recorder
follows that grid rather than each clan's drifted start. One clock means every
war number is comparable across clans and across weeks.

The vocabulary, from smallest to largest:

| Word | Meaning |
|---|---|
| `war_day` | 1-based: the four battle days of a week are war days 1 to 4; `null` on a training day |
| `day_in_week` | 0-based: days 0 to 2 are training, 3 to 6 are battle days. `war_day = day_in_week - 2` on a battle day |
| period | one policy day; `period_index` counts them from the season start |
| section | the game's word for a week; `section_index` is 0-based and `week` is 1-based |
| season | first Monday of the month to first Monday of the next, resetting at 10:00 UTC; the weeks are the Mondays between |
| Colosseum | always the season's final section, scored differently in the game; its practice days still report as training |

The record holds that grid as rows, one per policy day of every season,
and **a war battle is filed by where its `battle_time` falls on it**, for
the clan the player was in when it was played. The API stamps nothing on a
war battle beyond its type and time, so the record stamps nothing either:
attendance in `war_current`, `war_days` in `war_history` and the per-day
columns of `clans_participation` all count every recorded war battle
this way, however long after the fact it was recorded. The one thing that
is a clan's own is the instant its race actually closed, which sits inside
the half hour before 10:00 UTC and differs per race; a battle played in
that gap belongs to the new day in the game and to the old day on the grid.

`game_clock` answers all of this for nobody in particular (pass `at` to learn
what day a recorded battle fell on) and is the right first call when a
question begins "today" or "this week". `war_current` is what a specific clan
is doing inside that day.

It also carries the next boundaries, so a scheduled routine can decide for
itself when to look: `day_ends_at` (this policy day), `war_day_closes_at`
(the same instant on a war day, `null` on a training day),
`next_war_day_opens_at`, `next_training_starts_at`, `week_ends_at` and
`season_ends_at`. Nothing in the event feed announces the time; a routine that
wants to act three hours before a war day closes reads the clock once and sets
its own timer.

Because the recorder follows the policy grid, `war_current` gives you both the
grid and what it actually saw:

- `period_start_nominal`, `period_end_nominal` and `week_end_nominal` are the
  policy instants. **Cite these** when you say when a day ends.
- `started_observed_at` is when the recorder first saw this period open;
  `observed_offset_minutes` is its distance from the policy hour, **including
  polling latency**, so it is an upper bound on the clan's real drift.
- Battles in the drift gap, played after the clan's real reset but before
  10:00 UTC, land on the **previous** policy day. The first sign is a member
  counted with five decks: `decks_today.over_cap` lists members observed
  with more than four decks in a policy day rather than rounding them away.
- `nominal_period_elapsed` says the observed period's window has ended; a
  new period is not asserted until it is observed. Check
  `period.source_observed_at` and `game_clock` before calling a day over.

## Windows and timezones

Every windowed tool takes the same bounds and echoes what it used:

- `from` is inclusive and `to` exclusive. Each is an ISO 8601 instant, taken
  as given, or a date `YYYY-MM-DD`, resolved in a timezone. A date-only `from`
  is local midnight; a date-only `to` covers **that whole day**, ending at the
  next local midnight (exclusive), so `from: "2026-09-01", to: "2026-09-07"`
  is seven full days.
- The timezone is the account's, or the call's own `timezone` argument (an
  IANA name such as `Europe/Paris`), which also drives `battle_time_local`
  and every other local label. Agents serving people in several zones pass
  the asker's. `meta.timezone_applied` names the zone that applied.
- `days` and `weeks` are sugar: `days: 7` is `from` seven days before now
  with no `to`. `seasons` on `war_history` counts seasons back the same way.
- Every windowed response echoes `applied.window` with `from`, `to`,
  `timezone` and a `source`: `argument` when you gave bounds, `default` when
  the tool's default applied, `unbounded` when nothing bounded the window,
  `season` when a season's bounds applied (below), and `fixed` on the one
  tool whose window is not an argument. An agent quoting "your last 30
  days" reads `source` before it says so.

The defaults differ by tool, and each says which applied:

| Tool | Window when you give none |
|---|---|
| `players_summary` | fixed 30 days (`source: "fixed"`); not an argument |
| `battles_meta_decks`, `battles_meta_cards`, `cards_synergy` | the current season to date (`source: "season"`); `season` selects another |
| `clans_standings` | 30 days |
| `clans_pilot_scores` | 90 days |
| `clans_participation` | 5 ISO weeks, the current one included |
| `battles_trends` | 12 weeks |
| `battles_performance`, `battles_decks`, `battles_query`, `battles_cards`, `battles_opponents` | unbounded: the whole recorded history, said so in `applied.window.source` |

## Seasons

A season is a row in the record: first Monday of the month 10:00 UTC to
the next first Monday 10:00 UTC, named the way the API names it, by the
month it starts in (`2026-09`), and carrying the river race season number
the war surfaces speak (`136`). The record derives that number from the
month and confirms it against every war log entry it admits; the two have
never disagreed, and if they ever do the record alarms rather than
relabelling anything. The in-game Pass season (its number and its name) is
not in the API and is not in the record; an agent that knows it may say
it, the record never will.

**Balance changes are not modelled**, deliberately: nothing hand-fed or
scraped enters the data layer. Supercell ships balance changes on the
season roll, so **a season is the window that honours them**: card and
deck numbers inside one season are one population, and numbers that span a
roll are not. That is why the meta tools (`battles_meta_decks`,
`battles_meta_cards`, `cards_synergy`) default to **the current season to
date** rather than a rolling number of days, which on most days of the
month mixes two seasons without saying so.

- **`season`** on those three tools and on `battles_trends` bounds the
  window to one season: `"current"` (the default on the meta tools; to
  date), `"previous"`, the month (`"2026-08"`) or the war number (`135`).
  `from`/`to`/`days`/`weeks` given still win.
- **`applied.window.season`** names the season the window starts in
  (`month`, `war`, `starts_at`, `ends_at`), whatever set the window;
  `null` when it starts before the record's calendar.
- **`applied.window.crosses`** lists every season roll inside the window
  (`kind`, `at`, `from_season`, `to_season`); an empty array means the
  window is season-clean. Nothing is refused: an agent asking across a
  roll may mean it, and a note says so in a sentence so the caveat travels
  with the numbers. `crosses` is what lets a consumer refuse for itself.
- **`applied.window.season_age_days`** is how old that season is at the
  window's end. On the first days of a season the default window is thin
  and the record says so rather than widening it: `insufficient_sample`
  fires as it always did, and a note names `season: "previous"` as the
  settled comparison.
- `battles_trends` keeps its twelve-week default and crosses rolls by
  design; every week row carries `season_month`, the season its Tuesday
  to Sunday fall in, so a chart can draw the line where `crosses` puts it.

`game_clock` carries the same two names (`season_id`, `season_month`) and
the season's bounds for now.

`group_by: "week"` on `battles_performance` and every row of
`battles_trends` use **ISO weeks**, Monday to Sunday. A war week, by
contrast, runs on the policy grid above, Monday 10:00 UTC to Monday 10:00
UTC; the two start on the same weekday and ten hours apart, so never join
them by date alone.
