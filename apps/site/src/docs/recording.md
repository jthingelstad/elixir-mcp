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

## Relationships, primary, nicknames

Each player you track is your `primary` (exactly one: the first you track,
or whichever you mark `relationship: "primary"`), an `alt`, a `friend`, or
someone you are `watching` (the default). The primary is what "omit
`player_tag`" means on your connection. Claims are taken at your word
(`claim_status: unverified`); several accounts may track the same player and
share the recording.

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
players, ties broken by the clan's best-placed player. Both count over
**everyone above the rating floor**, not a top-100 slice; a Path of Legends
board lists only players above that floor, and a season resets everyone below
it, so a board is small in a season's first days and fills through the month.
`live: true` on either asks for a read of the board no older than a minute:
served if in hand, otherwise queued while the latest snapshot answers with
`live_status.state: "pending"`.

**Everything else the API forgets about a season** is recorded beside it.
A season's **final** Path of Legends board — the settled standing at full
depth, 9,999 places — is fetched once the day after it rolls and was
backfilled for every season since October 2022, the ranked ladder's first;
read it with `board: pol_final` and a `season`, either the number
`game_clock` counts (135 for August 2026) or the API's own name for the
season, the month it started in (`2026-08`). The Pass's in-game "Season 87"
is a third numbering the API does not use anywhere. The **clan ladders** (`clans` by clan
score, `clanwars` by clan war trophies, 1,000 places by location) are
recorded daily for global, the United States and Japan — `rankings_clan_ladder`.
The **game-mode leaderboards** (Merge Tactics, Touchdown, 2v2 League and the
rest) are enumerated from the API daily, so a board that rotates in is
followed without anyone naming it — `board: mode` with the board's id.
**What was on** — the events the API listed as running, with no dates — is
recorded daily as sightings, so `game_events` is the season's calendar built
from the days each event was seen. `rankings_timeline` reads any of the player
boards across a window: a player's rank and rating at every snapshot, a
clan's rated players and best rank, or the board's own floor, summit and
field size — the season story at daily resolution.

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
whole collector fleet stays inside. The rules below only ever shorten each
other.

| Subject | Rule | Bounds |
|---|---|---|
| Battle log | poll when about five new battles are expected, from an exponentially weighted average of battles per hour actually harvested | 15 minutes to 24 hours; a new subject starts hourly |
| Battle log, burst bound | poll before half the fastest time this player has recently filled the log (busiest six-hour window of the last 14 days) | never above the yield rule |
| Battle log, reader cap | any player resolved by a tool call (yours, or one you named) is polled at least hourly for the next 24 hours | – |
| Battle log, floor | at least daily regardless | – |
| **The roster gate** (battle log and profile) | a clan roster carries the game's own `lastSeen` for every member. When a **tracked** clan's roster is fresher than a member's last poll and says they have not been in the game since it (and their last sighting is more than two hours old, so a session in progress never gates), the poll is skipped: there is nothing new to fetch. A member who has been seen since is polled on the rules above. An incidental clan's roster (read every 4 to 24 hours) never gates: it is too stale to stand in for a battle-log poll, and in its first day it let sessions roll past the 25-entry log | overrides every rule above, including the floor |
| Profile | every 8 hours once a roster fresher than the last poll shows the player active; without roster information, every 8 hours for active players (0.5 battles/hour or more), daily for most, every 3 days when dormant; a player somebody tracks directly is capped at 8 hours; forced once in the hour before the Monday donation reset | no floor: an idle player owes the record no snapshot |
| Clan roster, tracked | every 15 minutes while members are in the game (three or more seen this hour); hourly once nobody has been for an hour, unless the roster is churning (three or more joins, departures or promotions a day); every 4 hours once nobody has been seen for a day | floor 2 days |
| Clan roster, incidental | a clan read only because a recorded player is in it: every 4 hours while members are in the game, every 12 hours when idle, daily when nobody has been seen for a day. Their profile polls carry their clan tag, so membership history is never lost, only coarser | floor 2 days |
| Current river race | every 30 minutes on war days, every 2 hours on training days (the API names the day) | floor 2 hours |
| River race log | daily | floor 2 days |
| Card catalog | daily, one fetch for everyone | – |

Subjects added together are de-phased by a stable per-subject offset so a
batch does not poll in lockstep. A burst can still roll off the log between
two polls; the [Status](/status/service) page publishes how many of the
last day's polls found that it had, and so does `capture_audit_24h` in
`/api/public/status`.

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

## Completeness

`elixir_coverage({ player_tag? })` returns:

| Field | Meaning |
|---|---|
| `polls[]` | `{ endpoint, last_admitted_at }` for `player` and `player_battlelog` |
| `battles` | `recorded_appearances`, `first_recorded`, `last_recorded`, including appearances recorded from other players' logs before the tag was added |
| `snapshots.first_date` | first daily profile snapshot; timelines exist only from here |
| `observation_intervals[]` | consecutive profile snapshots bracket an interval; `expected_battles` is the lifetime battle counter's change, `captured_battles` counts recorded battles in `(observed_from, observed_to]`; `is_complete` and `ratio` are `null` with a `note` when the two are not comparable |
| `completeness_last_7_days` | `average_ratio` weighted by expected battles over intervals ending in the last 7 days; `measured_intervals`, `unknown_intervals`, `incomplete_intervals`; `unmeasured_tail_hours` is the age of the unbracketed tail after the latest profile; `incomplete_days` is always `null` |

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
| `weeks[]` | the ISO weeks covered (`iso_week`, `from`, `to`, `complete`); Monday 00:00 UTC to Monday, the current week partial |
| `war_weeks[]` | the clan's recorded war weeks inside the window with their observed bounds; war weeks run on the game's grid, not ISO weeks |
| `members[].battles`, `ranked_battles`, `donations` | columns aligned to `weeks[]`, one entry per ISO week in order; `donations` is the game's weekly counter as of the last daily snapshot in the week, `null` with no snapshot |
| `members[].war_decks`, `war_points`, `war_decks_by_day`, `war_battles_by_day` | columns aligned to `war_weeks[]`; `war_decks_by_day` holds war days 1 to 4 from roster polls during the day (`null` where the day was not polled) and `war_battles_by_day` the member's recorded war battles each day. `verbosity: "compact"` keeps only `war_decks` |
| `members[].joined_observed_at`, `tenure_known`, `days_in_clan_observed` | when the record first saw them in the clan; `tenure_known` is `false` for a member already present at the first roster poll, whose observed days are a lower bound |
| `members[].last_battle_time`, `days_since_battle` | the last recorded battle in any clan, and its age |
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

Six recorded tools take the flag: `players_profile` for any tag,
`clans_roster` and `war_current` for **any clan, recorded or not**,
`battles_query` to poll a player's battle log (the "what did they just
play" path), and the two board tools. Prefer these; they are the live lane
with the record's shape.

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
