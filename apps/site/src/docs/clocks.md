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

`game_clock` answers all of this for nobody in particular (pass `at` to learn
what day a recorded battle fell on) and is the right first call when a
question begins "today" or "this week". `war_current` is what a specific clan
is doing inside that day.

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
  and `fixed` on the one tool whose window is not an argument. An agent
  quoting "your last 30 days" reads `source` before it says so.

The defaults differ by tool, and each says which applied:

| Tool | Window when you give none |
|---|---|
| `players_summary` | fixed 30 days (`source: "fixed"`); not an argument |
| `battles_meta_decks`, `battles_meta_cards`, `cards_synergy` | 28 days |
| `clans_standings` | 30 days |
| `clans_pilot_scores` | 90 days |
| `battles_trends` | 12 weeks |
| `battles_performance`, `battles_decks`, `battles_query`, `battles_cards`, `battles_opponents` | unbounded: the whole recorded history, said so in `applied.window.source` |

`group_by: "week"` on `battles_performance` and every row of
`battles_trends` use **ISO weeks**, Monday to Sunday. A war week, by
contrast, runs on the policy grid above, Monday 10:00 UTC to Monday 10:00
UTC; the two start on the same weekday and ten hours apart, so never join
them by date alone.
