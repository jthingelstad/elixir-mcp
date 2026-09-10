---
slug: recording
title: "Recording and coverage"
description: "What is recorded when you add a player or a clan, how one recording is shared by everyone who wants it, what activity and comprehensive scope poll, how often each subject is fetched, how to read freshness and completeness, and what live_fetch can reach."
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

There is no watch step and no approval queue. Adding a subject to your account
is the request to record it, and capture starts at the next scheduler tick.

| Act | Tool | Web | Scope needed |
|---|---|---|---|
| Record a player | `elixir_add_player({ player_tag, relationship?, make_primary? })` | Account → Tracking | `recordings:write` |
| Record a clan | `elixir_add_clan({ clan_tag, scope? })` | Account → Overview | `recordings:write` |
| Stop | the same tools with `action: "remove"` | same | `recordings:write` |
| Silence the feed without stopping | `action: "notify_off"` / `"notify_on"` | same | `recordings:write` |

Slots are the only gate; see [Limits](/docs/limits).

### One recording, many reasons

Every subject has at most one active recording, shared by everyone who wants
it. The recorder counts the reasons a subject is wanted and starts, widens,
or stops the recording accordingly:

| Reason | Source |
|---|---|
| claimed | any account added the player |
| added | any account added the clan |
| added deep | any account added the clan at `comprehensive` scope |
| collected | the subject is a member of a collection |
| collected deep | a member of a `comprehensive` collection |
| ops | the maintainer records it directly; never stopped by user actions |

The widest reason wins. Removing your own reason frees your slot; the
recording stops only when no reason remains anywhere. A clan's scope settles
up or down to the widest remaining reason; a player's scope only ever widens.
History is never deleted when a recording stops.

### Scope: what is actually polled

| Subject | `activity` | `comprehensive` |
|---|---|---|
| Player | profile only | profile and battle log |
| Clan | clan roster, current river race, river race log | the same, plus profile and battle log for **every current member**, following joins and leaves |

Players you add are always comprehensive. `elixir_add_clan` defaults to
`comprehensive`; the member tier has no comprehensive slot, so pass
`scope: "activity"` there. A recorded player's current clan is also read
every 15 minutes for roster and membership tracking, without a slot and
without polling the other members.

### Relationships, primary, nicknames

Each player you add is your `primary` (exactly one; the first you add),
an `alt`, a `friend`, or someone you are `watching` (the default). The
primary is what "omit `player_tag`" means on your connection. Claims are
taken at your word (`claim_status: unverified`); several accounts may add the
same player and share the recording.

`elixir_nickname({ player_tag, nickname })` stores a private label (1 to 40
characters, `null` clears) that only your account and your agents see;
`players_search` ranks your nicknames first. It is the one write the website's
Explore page performs.

### Collections

A collection is a curated, named group (slug `^[a-z0-9][a-z0-9-]{1,38}$`,
public or private, `player` or `clan` kind) that **records its members**:
adding a tag to a collection is a recording reason like any other, at the
collection's scope (`comprehensive` by default). `collections_edit` takes
`add`, `remove` or `set` with up to 500 tags per call and refuses the whole
call on one malformed tag. Collections are a family-tier feature; reading
public ones needs only `cr:read`.

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
| Profile | every 8 hours for active players (0.5 battles/hour or more), daily for most, every 3 days when dormant; forced once in the hour before the Monday donation reset | floor 3 days |
| Clan roster | every 15 minutes | floor 1 hour |
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
| `completeness_last_7_days` | `average_ratio` weighted by expected battles over intervals ending in the last 7 days; `measured_intervals`, `unknown_intervals`, `incomplete_intervals`; `incomplete_days` is always `null` |

Two caveats the numbers cannot escape: the lifetime counter includes some
modes the battle log never shows, so a ratio under 1.0 is an upper bound on
loss; and the tail after the latest profile snapshot is not measured. Missing
coverage is unknown, not evidence of absence.

`players_timeline` adds `snapshots_available_from` and a `range_note` when
you ask for dates before snapshots began.

## Reading the game live

`live_fetch({ path })` performs one authenticated GET against the Clash
Royale API through the live lane and records the result on the way back.

| Allowed `path` | Recorded as |
|---|---|
| `/players/{tag}` | `player` |
| `/players/{tag}/battlelog` | `player_battlelog` |
| `/clans/{tag}` | `clan` |
| `/clans/{tag}/currentriverrace` | `currentriverrace` |
| `/clans/{tag}/riverracelog` | `riverracelog` |
| `/locations/{id}/rankings/players` | `rankings_players` (`id` is `global` or numeric) |
| `/locations/{id}/pathoflegend/players` | `rankings_pol` |

Anything else is `bad_request`. The response is `{ path, live: true, data,
meta }` with `data` the raw payload: card levels there are on the API's
rarity-relative scale (a maxed legendary reads 8/8), while every recorded
tool serves the in-game 1 to 16 scale; `cards_catalog` carries both maxima.
The call waits up to 12 seconds for a live-channel collector and answers
`live_unavailable` otherwise. `players_profile({ live: true })` is the same
lane for one profile and falls back to the recorded snapshot with a hint.

Live fetches are capped per day by tier (20 / 100 / 250 / 1,000; owner and
admin unlimited) and an agent spends its owner's allowance. Leaderboard
fetches also enrol the ranked tags into the corpus.
