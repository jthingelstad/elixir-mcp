---
slug: freshness-and-gaps
title: "Freshness and gaps"
description: "How often Elixir reads each player and clan, how a response reports freshness, what the daily series holds, what a gap means, and how to read the game live."
section: record
order: 2
navTitle: "Freshness and gaps"
icon: clock
lede: "How often each thing is read, how fresh an answer is, and what a gap in the record means."
---

# Freshness and gaps

## How often a subject is fetched

Recording is a schedule over one shared, conservative API budget that the
whole collector fleet stays inside: one request a second, a tenth of it held
back for live reads. [Status and data](/data#right-now) shows how much of the last
24 hours' share was spent. For players the schedule is **the
session clock**, one rule you can hold in your head:

> While you are playing, your battle log is read every 30 minutes. After a
> read that found nothing new the wait doubles, and it never passes two
> hours. Your profile is read once a day, and once after a session.

Why 30 minutes and two hours: a battle is about three minutes, and the
API's battle log holds your last 30, so a sitting fills it in about 90
minutes. Read inside a third of that and a session cannot roll past the
recorder; read at least every two hours and a sitting that starts the
moment after a read still fits. The signed-in
[efficiency](/console/status/efficiency) page measures what is still lost,
per day, against the game's own lifetime battle counter.

| Subject | Rule | Bounds |
|---|---|---|
| Battle log | 30 minutes after a read that delivered battles; after an empty read the wait doubles (60, then 120 minutes) | never past 2 hours; a new subject is read at the next planning tick, usually within a few minutes |
| Battle log, reader cap | any player resolved by a tool call (yours, or one you named) is polled at least hourly for the next 24 hours | – |
| Battle log, floor | at least daily regardless, even under a starved budget | – |
| Profile | once a day; a player somebody tracks directly, every 8 hours; forced once in the hour before the Monday donation reset and before the season rolls | no floor: an idle player owes the record no reading |
| Profile, after a session | a battle log that delivered battles asks for the profile at the next planning tick, unless a profile was read in the last 8 hours | one outstanding request per player |
| Profile, arena request | a battle log names the arena each battle was played in, and that arena is the higher side's: a player just under a trophy gate is matched with people standing on it, and their own log shows the next arena for those battles. So only a Trophy Road battle the player entered with at least their opponent's trophies says where the player stood. When such a battle names an arena the latest reading does not carry, the profile is polled at the next planning tick, and the arena move lands on the timeline within the battle log's cadence rather than the profile's | one outstanding request per player; served by the next profile admission |
| Clan roster, tracked | every 15 minutes while members are in the game (three or more seen this hour); hourly once nobody has been for an hour, unless the roster is churning (three or more joins, departures or promotions a day); every 4 hours once nobody has been seen for a day | floor 2 days |
| Clan roster, incidental | a clan read only because a recorded player is in it: every 4 hours while members are in the game, every 12 hours when idle, daily when nobody has been seen for a day. Their profile polls carry their clan tag, so membership history is never lost, only coarser | floor 2 days |
| Current river race | every 30 minutes on war days, every 2 hours on training days (the API names the day) | floor 2 hours |
| River race log | daily, plus one catch-up after a newer recorded race when the preceding race lacks final closure, or after an unfinished recorded colosseum season’s nominal end while the new race is unavailable | floor 2 days |
| Card catalog | daily, one fetch for everyone | – |
| Game events | once per game day, at the first planning tick after 10:00 UTC; one fetch for everyone | – |

Subjects added together are de-phased by a stable per-subject offset so a
batch does not poll in lockstep; the offset can shorten a battle log's
wait but never take it past the two-hour ceiling.

A read that fails is tried again 15 minutes later, then 30, then 60,
before the subject waits for its own schedule again, so an outage costs
minutes rather than a whole cycle: an events read that
fails just after 10:00Z is read again the same day. The retries come out
of the same budget. A not-found answer is the exception: a subject the
API answers 404 for is tried once a day.

A sitting can still, rarely, roll past a
read; the public status endpoint publishes how many of the last day's
reads found that it had (`capture_audit_24h` in `/api/public/status`, with
no sign-in; [Status and data](/data#right-now) is the public page), and the
signed-in [service](/data/service) and
[efficiency](/console/status/efficiency) pages turn that into battles lost per day.

## Freshness, as the envelope reports it

Every response's `meta` says what it was built from:

| Field | Meaning |
|---|---|
| `source_polls.<endpoint>.observed_at` | the last **admitted** poll of that source; `null` if never polled |
| `source_polls.<endpoint>.freshness_seconds` | age of that poll at `as_of`; `null` when `observed_at` is |
| `freshness_seconds` | the **oldest** relevant source age; `null` if any required source has never been polled |
| `recorded_since` | earliest stored history for the subject, which can predate any account adding it (imports, opponents' logs) |
| `recording_active_since` | when the current active recording began |

Freshness advances only when a payload is admitted, never on a fetch that was
refused, so a stale value is honest.

## Daily series

Three tables hold the record's day-grained history, one row per subject per
[game day](/docs/clocks#the-game-day), the last reading of the day winning:

| Series | Written by | From | Read by |
|---|---|---|---|
| a player's day (trophies, donations, arena, clan and rank, the game's own last-seen, and for a recorded profile the lifetime block: battles, wins, losses, three-crown wins, star points, collection level, king tower level, total donations, challenge and tournament counters, Path of Legends standings, and the API's legacy `leagueStatistics` as `season_trophies` / `season_best_trophies`, which mirror Trophy Road and a frozen best, not the seasonal Trophy Road: read that with `progress_key`) | the roster poll of every clan the recorder follows (every member, whether or not their profile is recorded) and the profile poll of every recorded player, sharing one row | 2026-03-07 for the first recorded players; 2026-03-11 for POAP KINGS' members; the day a clan or player is first polled otherwise | `players_timeline`, `clans_members_timeline` |
| a clan's day (clan score, war trophies, member count, required trophies, weekly donations, and on request `type` and `location_id`) | the roster poll | 2026-03-11 for POAP KINGS; the first poll otherwise | `clans_timeline` |
| a player's progress buckets (the seasonal Trophy Road, 2v2 League, Merge Tactics: trophies, best trophies, arena per bucket) | the profile poll | 2026-03-07 | `players_timeline` with `progress_key` |

Two writers share a member's row. The roster writes trophies, donations,
donations received, arena, the clan, the rank and the game's last-seen at
its own cadence (every fifteen minutes for a tracked clan); the profile writes
the lifetime block at its own (every eight hours or slower). Each writer's
columns are dated by its own stamp (`roster_observed_at`, `profile_observed_at`),
the shared columns belong to whichever reading is newer, and `observed_at`
is the newest of either. So "trophies on day D" is the day's last read from
either source; "wins on day D" is the day's last profile read, and a day the
roster wrote with no profile poll carries the roster's columns and null
elsewhere, with `profile_observed_at` null to say so.

A successful admitted profile read advances `profile_observed_at` even when
the projected values are unchanged. This is an reading, with no new fact; it preserves newer roster values, and an older
delivery cannot move the stamp backward. A recent unchanged profile is not
proof of no battle activity in every mode. Profile counters and the API's
limited battle-log history have different scopes; logging in or collecting
rewards does not establish battle activity either.

`clans_roster` carries the clan's own `type` (`open`, `inviteOnly`,
`closed`), `location_id` (the API's location code) and `description` as the
last roster poll carried them, at both verbosities: the first three things a joiner asks. At full verbosity it
carries each member's latest profile row as
`lifetime` (`profile_observed_at`, `best_trophies`, `battle_count`, `wins`, `losses`,
`three_crown_wins`, `collection_level`, `king_tower_level`,
`total_donations`), `null` for a member whose profile is not recorded, plus
the three frozen career counters the profile carries on the player rather
than the day: `war_day_wins` (the game's own `warDayWins`) and
`clan_cards_collected` (`clanCardsCollected`), both counters of the retired
Clan Wars format, frozen since it ended, so 0 on newer accounts and never
counting a River Race battle or a donation, and
`legacy_trophy_road_high_score` (the best on the old Trophy Road). For war
results use `battles_performance` with `mode: "war"`; for donations,
`total_donations`. `players_profile.attributes` carries the same three.

A player's past Path of Legends finals are kept once per season: the
profile poll in the following month carries the API's
`lastPathOfLegendSeasonResult`, and the record files it under the season it
closes (`league`, `trophies`, `rank`; `rank` is `null` unless the player was
globally ranked). `players_profile.snapshot.path_of_legend.seasons[]` lists
the last twelve, newest first, keyed by `season_month`; the archive holds
every recorded player's final since March 2026 and the series tools carry
the standing at the roll hour (`players_timeline({ kind: "season_roll" })`).

`clans_timeline`'s `members_with_profile` counts the members with a
profile read on or before that day: the denominator of the profile-derived
aggregates. A member whose profile was not polled that day counts with their
latest earlier read, and `members_profile_carried` says how many did.
A profile's wins and collection level only climb, so the last read is the best
statement of the day. `members_seen` counts the member rows the roster wrote on
that day, whatever the clan's `members` said. It reads above `members` on a
day a member left: their row keeps the clan's tag until the next roster places
them elsewhere, so the day counts both the leaver and whoever the count
settled on. It reads below `members` on a partial day (the roster was polled,
but not every member's row is on the game day's grid yet).

`source` on a point is `api` for a row from a recorded payload (live or the
archive backfill of 2026-09-17) and `elixir-bot` for the few rows imported
from an earlier bot for one clan on 2026-09-18: five member-only days before the
first archived roster (2026-03-07 to 03-11, their instant the bot's usual
roster hour) and the Sunday `pre_reset` rows for members whose profile was not
recorded then. A window that contains such a point says so in `notes[]`. The
July to September 2026 hole in the profile archive was filled by replaying
the bot's own profile payloads; that replay wrote rows and never moments, so
the timeline for those players is quiet over those weeks by rule, not by
absence of play.

`kind` selects the daily row (the default), the `pre_reset` row (the highest
weekly donation counter the record saw before the counters dropped to 0 at the
start of Monday UTC: a lower bound on the week's donations, since any made after
the last read before the reset are not in it)
or the `season_roll` row (the hour before the season rolls). A bucket of the
progress series that reads zero trophies and zero best trophies is not a row:
no record for no activity.

## Completeness

`elixir_coverage({ player_tag? })` returns:

| Field | Meaning |
|---|---|
| `polls[]` | `{ endpoint, last_admitted_at }` for `player` and `player_battlelog` |
| `battles` | `recorded_appearances`, `first_recorded`, `last_recorded`, including appearances recorded from other players' logs before the tag was added |
| `snapshots.first_date` | first daily profile reading; timelines exist only from here |
| `observation_intervals[]` | consecutive profile readings bracket an interval; `expected_battles` is the lifetime battle counter's change, `captured_battles` counts recorded battles in `(observed_from, observed_to]`; `is_complete` and `ratio` are `null` with a `note` when the two are not comparable |
| `completeness_last_7_days` | `average_ratio` weighted by expected battles over intervals ending in the last 7 days; `measured_intervals`, `unknown_intervals`, `incomplete_intervals`; `unmeasured_tail_hours` is the age of the unbracketed tail after the latest profile |

Two caveats the numbers cannot escape: the lifetime counter includes some
modes the battle log never shows, so a ratio under 1.0 is an upper bound on
loss; and `unmeasured_tail_hours` is not part of the ratio. Missing coverage is
unknown, not evidence of absence.

Ladder's calendar uses the individual intervals, not the average or poll
freshness, to support quiet days. A zero requires comparable complete intervals
covering the whole closed local day and a complete read of its battles. Gaps,
unbracketed tails, unread pages and clipped season days stay unknown. Recorded
battles remain evidence of play under any recording state.

`players_timeline` adds `snapshots_available_from`, and a line in `notes[]`,
when you ask for dates before readings began.

## Participation by week

`clans_participation({ clan_tag?, weeks?, verbosity? })` answers, for every open
member of a clan and every member who left inside the window, in one
call, what they did week by week and where they stood at each war finish: the raw material
for a clan's own participation rules, which Elixir does not have. It
measures; it never rates.

| Field | Meaning |
|---|---|
| `weeks[]` | the ISO weeks covered (`iso_week`, `from`, `to`); battles are bucketed Monday 00:00 UTC to Monday, while `donations` follows the counter's own week, the game days Monday 10:00 UTC to Monday 10:00 UTC; the current week carries `partial: true` with `covers` (the mark every clipped bucket carries) |
| `war_weeks[]` | the clan's recorded war weeks inside the window with their recorded bounds; war weeks run on the game's grid, not ISO weeks |
| `members[].battles`, `ranked_battles`, `donations` | columns aligned to `weeks[]`, one entry per ISO week in order; `battles` is the member's own battles (a boat defense is not one); `donations` is the highest value the game's weekly counter reached in the week's game days, Monday 10:00 UTC to Monday 10:00 UTC (the counter only climbs until the weekly reset), `null` with no reading |
| `members[].war_decks`, `war_points` | columns aligned to `war_weeks[]`; `war_decks` is the game's count for the race week, never split by war day: the API does not say which day a deck was played and a war day's rollover cannot be placed reliably at Elixir's scale. `null` where the member has no race row for the week; `verbosity: "compact"` keeps only `war_decks` |
| `members[].joined_observed_at`, `tenure_known`, `days_in_clan_observed` | the start of the member's **current stint** as the record saw it: a member who left and came back counts from the rejoin, except that a rejoin within 7 days of leaving continues the stint before it; `tenure_known` is `false` for a member already present at the first roster poll, whose recorded days are a lower bound |
| `members[].first_joined_at` | the member's first recorded join of this clan, whatever stints followed (`clans_roster.first_observed_in_clan` is the same instant) |
| `members[].last_battle_time`, `days_since_battle` | the last recorded battle in any clan, and its age |
| `members[].last_battle_time_in_clan` | the last recorded battle played as a member of this clan |
| `members[].log_recorded`, `recorded_since` | whether the member's battle log is recorded at all (the clan's every-member scope, or a recording of their own) and their first recorded battle; read `log_recorded` before reading a zero |
| `basis` | `recorded` when the clan's members' logs are recorded; `roster_and_war_only` for an activity-scope clan, where every battle count is zero by construction for a member whose `log_recorded` is false |
| `recording_active_since`, `first_roster_observed_at` | the recording horizon for the clan |
| `members[].in_clan_at_war_finish`, `role_at_war_finish` | columns aligned to `war_weeks[]`: whether the member was in the clan at the week's finish (`finished_observed_at`), and in what role. Read from the clan's roster reads on either side of the finish, and served only when the two agree. `null` is unknown, never absent: the week is unfinished, no read follows the finish yet, or the member's place changed between the two reads. A role is also `null` outside the clan, at a finish before `role_history_since`, and where the member's recorded role changes do not chain (an older roster admitted after a newer one leaves an order nothing can settle) |
| `members[].role_changes` | full verbosity: every role change recorded in the window, oldest first, with `role_before`, `role_after`, and the change's bracket: it happened after `window_start` (the read before) and by `observed_at` (the read that showed it) |
| `role_history_since` | the clan's first live roster read: role changes are recorded from it, since the roster history imported from POAP KINGS' earlier bot carries tenure, not roles |
| `former_members[]`, `former_member_count` | who left inside the window and has not come back: `role_at_departure`, `joined_observed_at` and `left_observed_at` of the membership that ended, `last_battle_time_in_clan`, and the same columns as `members[]`, whose battles and donations count only what they played and gave in this clan |

Null is unknown, never zero, throughout: a week with no reading has
`donations: null`, a war week with no race row for the member has
`war_decks: null`,
a member with no recorded battle has `days_since_battle: null`. Counts
cover recorded battles only; `elixir_coverage` per tag says how complete
a member's log is. `weeks` is 1 to 8 (default 5).

**An agent reads a table.** Over MCP the rows of `members` and
`former_members` are arrays, and `columns.members` and
`columns.former_members` name their entries once, in order: a list of
fifty objects repeats every key fifty times, and the 48,000-character
response cap has no room for that. Two more things are written shorter,
and nothing is dropped:

- an instant on a whole second is written without its `.000`
  (`2026-09-14T09:38:05Z`);
- `in_clan_at_war_finish` and `role_at_war_finish` are one column,
  `place_at_war_finish`: the role at that finish where it is known, else
  `true` in the clan or `false` not in it, else `null`, unknown. A role is
  only ever known for a member in the clan, so the two fields read back
  exactly.

The eight-week read of a 50-member clan with 20 departures answers in
under 40,000 characters at either verbosity. The JSON API's
`GET /clans/{tag}/participation` and the website serve the same rows as
objects with the two fields above, and have no cap.

To replay a clan's rules at a past finish, take the population from
`place_at_war_finish` (or, from the JSON API, `in_clan_at_war_finish`)
across `members` and `former_members` together, and each one's role from
the same column (`role_at_war_finish`); today's `role` is only today's.

## Reading the game live

`live: true` is a request for a read of the game no older than the API's
own cache: 60 seconds for players, battle logs, 120 for clans
and the river race. It is **asynchronous**. If such a read is in hand, the
tool answers from it (`live_status.state: "fresh"`). If not, one priority
fetch is queued for the next collector that checks in and the tool answers
*now* from the record as it stands, with `live_status: { state: "pending",
retry_after_s }` and a note saying so; call again after that and the fresh
view is there. A subject with no record at all answers `live_pending` with
the same `retry_after_s`. Nothing waits on a collector inside a call.

**A race that is still matchmaking is no race yet, not an error.** For a
minute or two after a season roll (the first Monday of the month, a few
minutes past 10:00 UTC), the game has created a clan's new river race but
not drawn its bracket: the race has no clans, standings or decks. A
`war_current({ live: true })` read that lands then answers
`live_status: { state: "matchmaking", fetched_at, retry_after_s }` with a
note, and the rest of the answer is the last race recorded; a clan with no
race recorded answers `live_pending` with the same `retry_after_s`. The
same note rides on `war_current` without `live: true` while the clan's
latest race read is that one. `live_fetch` of `/clans/{tag}/currentriverrace`
serves the API's own body (`state: "matchmaking"`, no `clan`) with the
same `live_status`. The record does not move: nothing is written for that
race, the clan is read again on its usual race cadence, the collector that
fetched it is not charged with a rejected fetch, and no race or war day is
counted as missed.

{{ tools.liveFlagCount }} recorded tools take the flag:
{{ tools.liveFlagNames }}. The player tools can read any tag;
`clans_roster` and `war_current` can read **any clan, recorded or not**;
`battles_query` polls a
player's battle log for the "what did they just play" path. Prefer these;
they are the live lane with the record's shape.

`live_fetch({ path })` is the raw catch-all: one authenticated GET against
the Clash Royale API through the live lane. **It stores nothing**: the
payload comes back to you and never enters the record, so a tag nobody
tracks stays unrecorded however often it is fetched. It needs the payload
itself, so until one is in hand it answers the error `live_pending` with
`retry_after_s`; once one is, it answers
`{ path, live: true, live_status, applied, data, notes, docs, meta }`, with
`data` the raw payload and a note naming the recorded tool that answers the
same path. Any read inside the API's cache window answers it, a recorded
one included.

| Allowed `path` | Endpoint |
|---|---|
| `/players/{tag}` | `player` |
| `/clans/{tag}` | `clan` |
| `/clans/{tag}/currentriverrace` | `currentriverrace` |
| `/clans/{tag}/riverracelog` | `riverracelog` |

`/players/{tag}/battlelog` is **refused** with `result_too_large` before the
lane is spent: a raw battle log cannot fit the 48,000-character delivery cap,
so the fetch would cost a live call and deliver nothing;
`battles_query({ player_tag, live: true })` polls the log once and answers in
the compact recorded shape. Any other path is `bad_request`, and a malformed
tag in it `invalid_tag`. Card levels in `data` are on the API's
rarity-relative scale (a maxed legendary reads 8/8), while every recorded
tool serves the in-game 1 to 16 scale; `cards_catalog` carries both maxima.
`live_unavailable` is answered only when the lane is not configured or the
fresh payload was refused at admission.

What a live read leaves behind:

| Read | What it records |
|---|---|
| `live_fetch` | nothing; the payload waits for your next call outside the record, for at most an hour |
| `live: true` on a recorded tool | the read, admitted and projected like a scheduled poll: the tool answers from the record, so the record is what moves |
| Verify's reads of your battle log | the battle log, as any poll of a tracked player |
| the first read of a player you add | the profile: the tag is tracked from the moment it is added |

Live fetches are capped per day by tier (20 / 100 / 250 / 1,000; owner and
admin unlimited), and an agent spends its owner's allowance; past the cap a
call is refused with `quota_exceeded`. A queued fetch is charged once, when
it is queued; a second ask while it is queued, a fresh read already in hand
and the follow-up call that finds it are free. When the shared API budget
has no room for a live read, nothing is queued or charged, and the answer
is pending with `retry_after_s` at the next scheduler tick. Every collector
in the fleet picks up a queued live fetch first, so the worst-case wait is
one check-in interval (15 seconds) plus the fetch.
