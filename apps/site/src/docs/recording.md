---
slug: recording
title: "Recording and coverage"
description: "What is recorded when you track a player or a clan, how one recording is shared by everyone who wants it, what activity and comprehensive scope poll, how often each subject is fetched, how to read freshness and completeness, and what live_fetch can reach."
section: start
order: 3
navTitle: "Recording"
icon: radar
lede: "What Elixir captures, how often, and why an answer is never a live scrape."
console: ["Your tracked players and clans, and their freshness", "/account/tracking", "Console ▸ Tracking"]
---

# Recording and coverage

The official Clash Royale API answers only "what is true right now": a
profile, a clan roster, and a battle log of roughly the last 30 battles
(most commonly exactly 30). Elixir MCP records those observations
continuously and keeps them. This page is what that promise means precisely.


## The game's own "last seen"

Clash Royale reports `lastSeen` for each member **inside a clan's member
list only** — a player's own endpoint does not carry it. Elixir MCP captures
it on every clan roster poll and serves it as `last_seen_in_game` on
`players_profile` and on each `clans_roster` member.

Three things worth knowing:

- It is **when the player was last active**, not when this service last
  looked, and not `last_recorded_battle` — which only moves when a battle
  was captured. A member who opens the game daily without battling is
  indistinguishable from a departed one without it.
- It is **the predicate the game uses** to seed a river race roster. Members
  last seen before a race began are absent from that race's participants
  entirely, whether or not they battle and whether or not they joined in
  time. That is why `war_current.members_not_in_race` and this field belong
  together.
- It **cannot be backfilled**, and it is only obtainable while a player is in
  a clan being polled. Null means no polled roster has carried them yet.

## Added means recorded

There is no watch step and no approval queue. **Tracked means recorded**:
tracking a subject on your account is the request to record it, and capture
starts at the next scheduler tick. (Before contract 1.0.0 the tools said
"add"; the act is the same.)

| Act | Tool | Web | Scope needed |
|---|---|---|---|
| Record a player | `elixir_track_player({ player_tag, relationship? })` | Account → Tracking | `recordings:write` |
| Record a clan | `elixir_track_clan({ clan_tag, scope? })` | Account → Overview | `recordings:write` |
| Stop | the same tools with `action: "remove"` | same | `recordings:write` |
| Silence the feed without stopping | `action: "notify_off"` / `"notify_on"` | same | `recordings:write` |

Slots are the only gate; see [Limits](/docs/limits).

## One recording, many reasons

Every subject has at most one active recording, shared by everyone who wants
it. The recorder counts the reasons a subject is wanted and starts, widens,
or stops the recording accordingly:

| Reason | Source |
|---|---|
| claimed | any account tracks the player |
| added | any account tracks the clan |
| added deep | any account tracks the clan at `comprehensive` scope |
| collected | the subject is a member of a collection |
| collected deep | a member of a `comprehensive` collection |
| ranked | the player appeared in the recording top-N of a [leaderboard](#leaderboards) this season; comprehensive, and sticky until the next season roll plus three days |
| ops | the maintainer records it directly; never stopped by user actions |

The widest reason wins. Removing your own reason frees your slot; the
recording stops only when no reason remains anywhere. A clan's scope settles
up or down to the widest remaining reason; a player's scope only ever widens.
History is never deleted when a recording stops.

## Scope: what is actually polled

| Subject | `activity` | `comprehensive` |
|---|---|---|
| Player | profile only | profile and battle log |
| Clan | clan roster, current river race, river race log | the same, plus profile and battle log for **every current member**, following joins and leaves |

Put plainly: **activity follows the clan itself** — its roster, its members
arriving and leaving, and its river races. **Comprehensive also records every
member's battles**, which is what builds the clan a full history rather than a
record of who was in it.

Every tier has one activity clan slot, and it is meant for your own clan: it is
what approval spends when your access request is granted, so the clan you play
in is being followed from your first sign-in. Comprehensive is the upgrade, and
it costs proportionally more to run — the member tier has none, so
`elixir_track_clan`, which defaults to `comprehensive`, needs
`scope: "activity"` there.

Players you track are always comprehensive. A recorded player's current clan is
also read for roster and membership tracking — a few times a day, following
the clan's own liveliness — without a slot and without polling the other
members.

**A roster poll records what it carries** (since 2026-09-17). Every clan the
recorder reads gets one row per game day of its own numbers (clan score, war
trophies, member count, required trophies, weekly donations), and every member
on that roster gets a row in the same daily series a recorded player's profile
writes — trophies, donations, clan rank, arena and the game's own last-seen —
whether or not their profile is recorded. The two writers share the row: a
member with a recorded profile has the profile's lifetime counters on it too,
and each half is dated by its own observation. The profile's progress buckets
(the seasonal Trophy Road, 2v2 League, Merge Tactics) are kept as a series of
their own; a bucket the player has not touched this season writes nothing. The
readers over these series arrive with the next contract bump; today
`players_timeline` already returns the roster-written days.

## Relationships, primary, nicknames

Each player you track is your `primary` (exactly one: the first you track,
or whichever you mark `relationship: "primary"`), an `alt`, a `friend`, or
someone you are `watching` (the default). The primary is what "omit
`player_tag`" means on your connection. Claims are taken at your word
(`claim_status: unverified`) until [Verify](/docs/verify) proves one;
several accounts may track the same player and share the recording.

`elixir_nickname({ player_tag, nickname })` stores a private label (1 to 40
characters, `null` clears) that only your account and your agents see;
`players_search` ranks your nicknames first. It is the one write the website's
Explore page performs.

## Collections

A collection is a curated, named group (slug `^[a-z0-9][a-z0-9-]{1,38}$`,
public or private, `player` or `clan` kind) that **records its members**:
adding a tag to a collection is a recording reason like any other, at the
collection's scope (`comprehensive` by default). `collections_edit` takes
`add`, `remove` or `set` with up to 500 tags per call and refuses the whole
call on one malformed tag. Collections are a family-tier feature; reading
public ones needs only `cr:read`.

Some collections follow a live board rather than a curator: the Path of
Legends top 100s (global, US, Japan) and the top 10 clans are re-synced
from their board every day after the 10:00Z snapshot. They carry
`synced_from` (6.24.0), and their membership is today's top of the board,
not a fixed cohort; 36 of the global 100 can turn over in a day. A
collection segment on the meta tools applies the membership as of the
call, so rates over a past window describe today's members. A board
collection's rows are ordered by Trophy Road trophies, which is not the
board's order: `rankings_players` and `rankings_clans` have that.

## Leaderboards

The CR API shows a ranking as it is this minute and forgets it. The recorder
keeps it: the global Path of Legends board and every location the API lists —
262 countries and regions — **once a day**, in the first planning tick after
10:00Z, the hour the season rolls, so a season's last daily snapshot is the
board as it stood going into the roll. Each fetch that
differs from the last becomes a snapshot with a row per placed player (rank,
rating, name, clan); an identical later fetch confirms the existing snapshot
rather than duplicating it, so the record also says how long a board held.

`rankings_players` reads a board — the latest, or as it was at any earlier
instant with `as_of` — paged, because a whole board can run to a thousand
places. `rankings_clans` aggregates it: which clans have the most rated
players, ties broken by the clan's best-placed player. Both count over the
**whole recorded board**, not a top-100 slice — and the whole board is the
API's top 1,000. A live Path of Legends board has two regimes, and the
payload says which one a snapshot is in. Below 1,000 rated players it is
**everyone above the rating floor**: a season resets everyone below the
floor, so a board is small in a season's first days and grows as players
cross it (Iceland's whole board is two players). At 1,000 it is **full**
(`snapshot.full: true`, `snapshot.depth: 1000`): the API serves exactly 1,000
places and offers nothing past them, so from then on the field is pinned at
1,000 and `floor_rating` — the last place's rating, on the snapshot and on
every point of `rankings_timeline`'s board curve — is a **cutoff that moves
with play, not a qualification threshold**. A player or clan can leave the
board without losing rating: on 2026-09-19 the global cutoff rose 2058 → 2111
and a quarter of the previous day's board was below it before anyone played.
So a clan's `rated_players` compared across dates moves with the cutoff as
well as with play, and can fall while every one of the clan's players
improves; compare it against `floor_rating` on the same dates (a clan's
timeline carries `board_full` and `board_floor_rating` beside the count, and
the board curve carries `floor_delta`). `truncated` means something else:
the API offered a cursor past the places the recorder keeps, which it never
does on a Path of Legends board — `truncated: false` on a full board means
the cut is the game's, not the record's. `live: true` on either tool asks for
a read of the board no older than a minute: served if in hand, otherwise
queued while the latest snapshot answers with `live_status.state: "pending"`.

The record begins 2026-09-11 for every player board (`meta.recorded_since`
on every rankings read). A `rankings_timeline` window that starts a day or
more before it says so — `applied.window.partial: true`, `covers` naming the
recorded span (null when none of the window is), and a note — so an empty
series before the horizon reads as unrecorded, never as a board that did
not change; `as_of` before it on `rankings_players` or `rankings_clans`
answers the same way.

**Everything else the API forgets about a season** is recorded beside it.
A season's **final** Path of Legends board — the settled standing, the
API's 9,999 places (`depth: 9999`; the tail is cut at #9999 mid-tie, so
more players finished at the last rating than the board shows) — is fetched
in the tick after it rolls and was backfilled for every season since
October 2022, the ranked ladder's first (S89 as `game_clock` counts); read
it with `board: pol_final` and a `season`, either the number `game_clock`
counts (135 for August 2026) or the API's own name for the season, the
month it started in (`2026-08`). The Pass's in-game "Season 87" is a third
numbering the API does not use anywhere, and a `pol_final` read of a season
before S89 says so, as a read of the season in progress says when its final
will be fetched and a season that has not happened names the current one;
`applied.season` is the ordinal the record resolved (null on a miss) with
`season_requested` beside it. A final never changes, so `live: true` is
refused there. The **clan ladders** (`clans` by clan
score, `clanwars` by clan war trophies, 1,000 places by location) are
recorded daily for global, the United States and Japan — `rankings_clan_ladder`.
The **game-mode leaderboards** (Merge Tactics, Touchdown, 2v2 League and the
rest) are enumerated from the API daily, so a board that rotates in is
followed without anyone naming it. Call
`rankings_players({ board: "mode", location: "list" })` for the recorded
ids, names and enabled state, then read `board: "mode"` with a returned
`location`. The catalog is a recorded read; omit `live` and `as_of` when
listing it. A mode board or badge is not evidence that its battles appear
in the API's battle log; missing recorded battles do not prove absence.
**What was on** — the events the API listed as running, with no dates — is
recorded daily as sightings, so `game_events` is the season's calendar built
from the days each event was seen. `rankings_timeline` reads any of the player
boards across a window: a player's rank and rating at every snapshot, a
clan's rated players and best rank, or the board's own last-place rating,
summit and field size — the season story at daily resolution.

**A top-200 appearance on the global board is a recording reason.** Any
player who reaches it is recorded at comprehensive scope — every battle,
with the rank and rating each one carried — until the next season roll plus
three days, however far they fall in between. That grace is deliberate: the
board is empty for the first hours after a roll, and the only way the opening
battles of the next season's #1 are captured is that they were recorded for
being in last season's field. The Trophy Road boards are watched but have
been served empty by the API for recent seasons.

## How often a subject is fetched

Recording is a schedule over one shared, conservative API budget that the
whole collector fleet stays inside. For players the schedule is **the
session clock**, one rule you can hold in your head:

> While you are playing, your battle log is read every 30 minutes. After a
> read that found nothing new the wait doubles, and it never passes two
> hours. Your profile is read once a day, and once after a session.

Why 30 minutes and two hours: a battle is about three minutes, and the
API's battle log holds your last 30, so a sitting fills it in about 90
minutes. Read inside a third of that and a session cannot roll past the
recorder; read at least every two hours and a sitting that starts the
moment after a read still fits. Before this rule (September 2026) the
recorder estimated each player's pace and waited up to a day for the
quiet ones; measured against the game's own lifetime battle counter, that
lost about 4% of all battles, almost all of them from long sittings that
started inside a long wait. The [Efficiency](/status/efficiency) page
publishes that loss, per day, from the same measurement.

| Subject | Rule | Bounds |
|---|---|---|
| Battle log | 30 minutes after a read that delivered battles; after an empty read the wait doubles (60, then 120 minutes) | never past 2 hours; a new subject is read within 30 minutes |
| Battle log, reader cap | any player resolved by a tool call (yours, or one you named) is polled at least hourly for the next 24 hours | – |
| Battle log, floor | at least daily regardless, even under a starved budget | – |
| Profile | once a day; a player somebody tracks directly, every 8 hours; forced once in the hour before the Monday donation reset and before the season rolls | no floor: an idle player owes the record no snapshot |
| Profile, after a session | a battle log that delivered battles asks for the profile at the next planning tick, unless a profile was read in the last 8 hours | one outstanding request per player |
| Profile, arena request | a battle log names the arena each battle was played in, and that arena is the higher side's: a player just under a trophy gate is matched with people standing on it, and their own log shows the next arena for those battles. So only a Trophy Road battle the player entered with at least their opponent's trophies says where the player stood. When such a battle names an arena the latest snapshot does not carry, the profile is polled at the next planning tick, and the arena move lands on the timeline within the battle log's cadence rather than the profile's | one outstanding request per player; served by the next profile admission |
| Clan roster, tracked | every 15 minutes while members are in the game (three or more seen this hour); hourly once nobody has been for an hour, unless the roster is churning (three or more joins, departures or promotions a day); every 4 hours once nobody has been seen for a day | floor 2 days |
| Clan roster, incidental | a clan read only because a recorded player is in it: every 4 hours while members are in the game, every 12 hours when idle, daily when nobody has been seen for a day. Their profile polls carry their clan tag, so membership history is never lost, only coarser | floor 2 days |
| Current river race | every 30 minutes on war days, every 2 hours on training days (the API names the day) | floor 2 hours |
| River race log | daily | floor 2 days |
| Card catalog | daily, one fetch for everyone | – |

Subjects added together are de-phased by a stable per-subject offset so a
batch does not poll in lockstep. A sitting can still, rarely, roll past a
read; the [Status](/status/service) page publishes how many of the last
day's reads found that it had (`capture_audit_24h` in
`/api/public/status`), and [Efficiency](/status/efficiency) turns that
into battles lost per day.

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
[game day](/docs/clocks#the-game-day), the last observation of the day winning:

| Series | Written by | From | Read by |
|---|---|---|---|
| a player's day (trophies, donations, arena, clan and rank, the game's own last-seen, and for a recorded profile the lifetime block: battles, wins, losses, three-crown wins, star points, collection level, king tower level, total donations, challenge and tournament counters, Path of Legends standings, seasonal trophies) | the roster poll of every clan the recorder follows (every member, whether or not their profile is recorded) and the profile poll of every recorded player, sharing one row | 2026-03-07 for the first recorded players; 2026-03-11 for POAP KINGS' members; the day a clan or player is first polled otherwise | `players_timeline`, `clans_members_timeline` |
| a clan's day (clan score, war trophies, member count, required trophies, weekly donations, and on request `type` and `location_id`) | the roster poll | 2026-03-11 for POAP KINGS; the first poll otherwise | `clans_timeline` |
| a player's progress buckets (the seasonal Trophy Road, 2v2 League, Merge Tactics: trophies, best trophies, arena per bucket) | the profile poll | 2026-03-07 | `players_timeline` with `progress_key` |

Two writers share a member's row. The roster writes trophies, donations,
donations received, arena, the clan, the rank and the game's last-seen at
its own cadence (every fifteen minutes for a tracked clan); the profile writes
the lifetime block at its own (every eight hours or slower). Each writer's
columns are dated by its own stamp (`roster_observed_at`, `profile_observed_at`),
the shared columns belong to whichever observation is newer, and `observed_at`
is the newest of either. So "trophies on day D" is the day's last read from
either source; "wins on day D" is the day's last profile read, and a day the
roster wrote with no profile poll carries the roster's columns and null
elsewhere, with `profile_observed_at` null to say so.

`clans_roster` carries the clan's own `type` (`open`, `inviteOnly`,
`closed`), `location_id` (the API's location code) and `description` as the
last roster poll carried them (`null` before 2026-09-17), at both
verbosities: the first three things a joiner asks. At full verbosity it
carries each member's latest profile row as
`lifetime` (`profile_observed_at`, `best_trophies`, `battle_count`, `wins`, `losses`,
`three_crown_wins`, `collection_level`, `king_tower_level`,
`total_donations`), `null` for a member whose profile is not recorded, plus
the three frozen career counters the profile carries on the player rather
than the day: `war_day_wins` (the game's own `warDayWins`) and
`clan_cards_collected` (`clanCardsCollected`), both counters of the retired
Clan Wars format, frozen since it ended, so 0 on newer accounts and never
counting a River Race battle or a donation (6.27.0: they used to be
described as lifetime war wins and donations), and
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

`clans_timeline`'s `members_with_profile` (3.16.0) counts the members with a
profile read on or before that day: the denominator of the profile-derived
aggregates. A member whose profile was not polled that day counts with their
latest earlier read (6.36.7), and `members_profile_carried` says how many did.
A profile's wins and collection level only climb, so the last read is the best
statement of the day; leaving the member out had moved the average with the
poll schedule. `members_seen` counts the member rows the roster wrote on
that day, whatever the clan's `members` said. It reads above `members` on a
day a member left: their row keeps the clan's tag until the next roster places
them elsewhere, so the day counts both the leaver and whoever the count
settled on. It reads below `members` on a partial day (the roster was polled,
but not every member's row is on the game day's grid yet).

`source` on a point is `api` for a row from a recorded payload (live or the
archive backfill of 2026-09-17) and `elixir-bot` for the few rows imported
from POAP KINGS' earlier bot on 2026-09-18: five member-only days before the
first archived roster (2026-03-07 to 03-11, their instant the bot's usual
roster hour) and the Sunday `pre_reset` rows for members whose profile was not
recorded then. A window that contains such a point says so in `notes[]`. The
July to September 2026 hole in the profile archive was filled by replaying
the bot's own profile payloads; that replay wrote rows and never moments, so
the timeline for those players is quiet over those weeks by rule, not by
absence of play.

`kind` selects the daily row (the default), the `pre_reset` row (the highest
weekly donation counter the record saw before the counters dropped to 0 at the
start of Monday UTC: the week's donation total)
or the `season_roll` row (the hour before the season rolls). A bucket of the
progress series that reads zero trophies and zero best trophies is not a row:
no record for no activity.

## Completeness

`elixir_coverage({ player_tag? })` returns:

| Field | Meaning |
|---|---|
| `polls[]` | `{ endpoint, last_admitted_at }` for `player` and `player_battlelog` |
| `battles` | `recorded_appearances`, `first_recorded`, `last_recorded`, including appearances recorded from other players' logs before the tag was added |
| `snapshots.first_date` | first daily profile snapshot; timelines exist only from here |
| `observation_intervals[]` | consecutive profile snapshots bracket an interval; `expected_battles` is the lifetime battle counter's change, `captured_battles` counts recorded battles in `(observed_from, observed_to]`; `is_complete` and `ratio` are `null` with a `note` when the two are not comparable |
| `completeness_last_7_days` | `average_ratio` weighted by expected battles over intervals ending in the last 7 days; `measured_intervals`, `unknown_intervals`, `incomplete_intervals`; `unmeasured_tail_hours` is the age of the unbracketed tail after the latest profile. `average_ratio` is a number (4.0.0; a three-decimal string before) |

Two caveats the numbers cannot escape: the lifetime counter includes some
modes the battle log never shows, so a ratio under 1.0 is an upper bound on
loss; and `unmeasured_tail_hours` is not part of the ratio. Missing coverage is
unknown, not evidence of absence.

`players_timeline` adds `snapshots_available_from`, and a line in `notes[]`,
when you ask for dates before snapshots began.

## Participation by week

`clans_participation({ clan_tag?, weeks? })` answers, for every open
member of a clan in one call, what they did week by week: the raw material
for a clan's own participation rules, which Elixir does not have. It
measures; it never rates.

| Field | Meaning |
|---|---|
| `weeks[]` | the ISO weeks covered (`iso_week`, `from`, `to`); Monday 00:00 UTC to Monday; the current week carries `partial: true` with `covers` (the mark every clipped bucket carries; 4.0.0, `complete` before) |
| `war_weeks[]` | the clan's recorded war weeks inside the window with their observed bounds; war weeks run on the game's grid, not ISO weeks |
| `members[].battles`, `ranked_battles`, `donations` | columns aligned to `weeks[]`, one entry per ISO week in order; `donations` is the game's weekly counter as of the last daily snapshot in the week, `null` with no snapshot |
| `members[].war_decks`, `war_points`, `war_decks_by_day`, `war_battles_by_day` | columns aligned to `war_weeks[]`; `war_decks_by_day` holds war days 1 to 4 from roster polls during the day (`null` where the day was not polled) and `war_battles_by_day` the member's recorded war battles each day. `verbosity: "compact"` keeps only `war_decks` |
| `members[].joined_observed_at`, `tenure_known`, `days_in_clan_observed` | when the record first saw them in the clan; `tenure_known` is `false` for a member already present at the first roster poll, whose observed days are a lower bound |
| `members[].last_battle_time`, `days_since_battle` | the last recorded battle in any clan, and its age |
| `members[].last_battle_time_in_clan` | the last recorded battle played as a member of this clan (3.16.0) |
| `members[].log_recorded`, `recorded_since` | whether the member's battle log is recorded at all (the clan's comprehensive scope, or a recording of their own) and their first recorded battle (3.16.0); read `log_recorded` before reading a zero |
| `members[].war_days_battled` | per war week, the days the member fought: a poll that saw decks used or a recorded war battle; `null` when neither source covered the week (3.16.0), so a weekly total is never spread over days |
| `basis` | `recorded` when the clan's members' logs are recorded; `roster_and_war_only` for an activity-scope clan, where every battle count is zero by construction for a member whose `log_recorded` is false (3.16.0) |
| `recording_active_since`, `first_roster_observed_at` | the recording horizon for the clan |

Null is unknown, never zero, throughout: a week with no snapshot has
`donations: null`, a war day nobody polled has `decks_used_today: null`,
a member with no recorded battle has `days_since_battle: null`. Counts
cover recorded battles only; `elixir_coverage` per tag says how complete
a member's log is. `weeks` is 1 to 8 (default 5). The per-member values
are columns rather than rows so a full clan over eight weeks fits the
response cap; should it not, the `result_too_large` hint names `weeks`
and `verbosity: "compact"`.

## Reading the game live

`live: true` is a request for a read of the game no older than the API's
own cache: 60 seconds for players, battle logs and boards, 120 for clans
and the river race. It is **asynchronous**. If such a read is in hand, the
tool answers from it (`live_status.state: "fresh"`). If not, one priority
fetch is queued for the next collector that checks in and the tool answers
*now* from the record as it stands, with `live_status: { state: "pending",
retry_after_s }` and a note saying so; call again after that and the fresh
view is there. A subject with no record at all answers `live_pending` with
the same `retry_after_s`. Nothing waits on a collector inside a call.

{{ tools.liveFlagCount }} recorded tools take the flag:
{{ tools.liveFlagNames }}. The player tools can read any tag;
`clans_roster` and `war_current` can read **any clan, recorded or not**;
the board tools name their board and location. `battles_query` polls a
player's battle log for the "what did they just play" path. Prefer these;
they are the live lane with the record's shape.

`live_fetch({ path })` is the raw catch-all: one authenticated GET against
the Clash Royale API through the live lane, recorded on the way back. It
needs the payload itself, so it answers `live_pending` until one is in
hand, then `{ path, live: true, live_status, data, meta }`.

| Allowed `path` | Recorded as |
|---|---|
| `/players/{tag}` | `player` |
| `/clans/{tag}` | `clan` |
| `/clans/{tag}/currentriverrace` | `currentriverrace` |
| `/clans/{tag}/riverracelog` | `riverracelog` |
| `/locations/{id}/rankings/players` | `rankings_players` (`id` is `global` or numeric) |
| `/locations/{id}/pathoflegend/players` | `rankings_pol` |

`/players/{tag}/battlelog` is **refused** with `result_too_large` before the
lane is spent: a raw battle log cannot fit the 48,000-character delivery cap,
so the fetch would cost a live call and deliver nothing;
`battles_query({ player_tag, live: true })` polls the log once and answers in
the compact recorded shape. Anything else is `bad_request`. The response is
`{ path, live: true, data, meta }` with `data` the raw payload: card levels
there are on the API's rarity-relative scale (a maxed legendary reads 8/8),
while every recorded tool serves the in-game 1 to 16 scale; `cards_catalog`
carries both maxima. `live_unavailable` is answered only when the lane is
not configured or the fresh payload was refused at admission.

Live fetches are capped per day by tier (20 / 100 / 250 / 1,000; owner and
admin unlimited) and an agent spends its owner's allowance. A queued fetch
is charged once, when it is queued; a fresh read already in hand and the
follow-up call that finds it are free. Every collector in the fleet picks
up a queued live fetch first, so the worst-case wait is one check-in
interval (15 seconds) plus the fetch. Leaderboard fetches also enrol the
ranked tags into the corpus.
