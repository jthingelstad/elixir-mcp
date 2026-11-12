---
slug: recording
title: "Recording and coverage"
description: "What is recorded when you track a player or a clan, how one recording is shared by everyone who wants it, what the clan-only and every-member scopes poll, how often each subject is fetched, how to read freshness and completeness, and what live_fetch can reach."
section: record
order: 1
navTitle: "What Elixir records"
icon: radar
lede: "What Elixir records, how often, and why an answer is never a live scrape."
callout: ["Open it at Settings › Players & tracking", "/settings/players", "Open Players & tracking"]
---

# Recording and coverage

The official Clash Royale API answers only "what is true right now": a
profile, a clan roster, and a battle log of roughly the last 30 battles
(most commonly exactly 30). Elixir MCP records those readings
continuously and keeps them. This page is what that promise means precisely.


## The game's own "last seen"

Clash Royale reports `lastSeen` for each member **inside a clan's member
list only**, a player's own endpoint does not carry it. Elixir MCP records
it on every clan roster poll and serves it as `last_seen_in_game` on
`players_profile` and on each `clans_roster` member.

Three things worth knowing:

- It is **when the player was last active**, not when this service last
  looked, and not `last_recorded_battle`: which only moves when a battle
  was recorded. A member who opens the game daily without battling is
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
tracking a subject on your account is the request to record it, and recording
starts at the next scheduler tick.

Adding a player also asks for one read of their profile, and then one of
their battle log, on the live lane, free and outside your quota, as
[Verify](/docs/verify) does. So the first recording usually lands within a
minute (a few when the live lane is busy, or when the day's first reads are
used and the scheduler makes them instead), and the battle-log read brings
roughly the last 30 battles with it (the game keeps no more; from
there the record builds forward). If Clash Royale answers that it has no
player with that tag (its "Player not found"), Settings › Players & tracking says so as an
error on the player's page within seconds of the add (it checks every few
seconds for the first minutes), and never shows that tag as recording or
freshly polled: check the tag, which is on the player's profile in the game
below the name, and type the right one in the same place (Elixir tracks it
instead, as your primary if the wrong one was) or stop tracking the wrong
one. Stats says **Tag not found** too, with the way to that fix. Any other failed read is only a failed attempt, retried on
the schedule below. A tag read or refused in the last day is not asked for
again. You and your agents together get one of these first reads a day for
each player slot you have ([Limits](/docs/limits)); a player added past that
is still recorded, and its first read comes with the scheduler's next round.

| Act | Tool | Web | Scope needed |
|---|---|---|---|
| Record a player | `elixir_track_player({ player_tag, relationship?, action? })` | Settings › Players & tracking | `recordings:write` |
| Record a clan | `elixir_track_clan({ clan_tag, scope?, action? })` | Settings › Players & tracking | `recordings:write` |
| Stop | the same tools with `action: "remove"` | same | `recordings:write` |
| Silence the feed without stopping | `action: "notify_off"` / `"notify_on"` | same | `recordings:write` |

Slots are the only gate; see [Limits](/docs/limits).

## What a player slot costs

A player slot pays for what Elixir records because of you, so following a
player Elixir already records is free. A player is free when either is true:

- they are a current member of a clan Elixir records at `comprehensive`
  scope (every member), whoever tracks that clan;
- another account followed them before you did. Your agents are part of
  your account here, and a suspended agent's follow counts for nothing.

A clan tracked at `activity` scope, including the clan Elixir follows for
your primary player, records the clan and not its members, so following one
of its members takes a slot. Whoever followed a player first pays for them,
so two accounts can never make each other's follows free.

The web says what a Follow costs before you tap it: **Free · already
recorded**, or **Uses 1 of your 50 player slots** with the number in use.
`elixir_track_player` and `POST /api/me/players` return a `slot` block
(`took`, `free`, `free_because`, `used`, `limit`), and Settings › Players &
tracking marks each player as free or using a slot.

[Settings › What members see](/settings/what-members-see) has your slots
in one place: a meter of the slots in use out of your limit, the same
number every Follow says, then the players using a slot because of you
(each with who follows them: you, or an agent of yours by name) and,
apart from them, the free follows with why each is free. A player you
follow or watch has **Stop following** there; your own players open on
Players & tracking, and a player only your agent tracks opens that agent's
page. A player your agent also tracks keeps its slot until the agent stops
too.

If a free player's reason goes away (they leave the clan, or the other
account stops following), they keep recording and start using one of your
slots. Nobody is removed for it: an account that ends up over its limit
keeps everything it tracks, and only a new follow that would take a slot is
refused, with the count and the reason. Free follows are never refused.

If your clans cannot be read, Home and the clans view of Players & tracking say
so and offer **Try again**. A failed read does not mean that you stopped
tracking a clan; any previously read clans stay available. Trying again reads
your saved tracking without adding a clan or forcing a game fetch. An empty list
is shown only when the relevant read succeeds.

## One recording, many reasons

Every subject has at most one active recording, shared by everyone who wants
it. The recorder counts the reasons a subject is wanted and starts, widens,
or stops the recording accordingly:

| Reason | Source |
|---|---|
| claimed | any account tracks the player |
| added | any account tracks the clan |
| added deep | any account tracks the clan at `comprehensive` scope |

Only people's tracking is a reason: the maintainer has no reason of their
own and tracks from an account like anyone else. The widest reason wins. Removing your own reason frees your slot; the
recording stops only when no reason remains anywhere. A clan's scope settles
up or down to the widest remaining reason; a player's scope only ever widens.
History is never deleted when a recording stops.

Extra pre-reset and season-roll readings preserve the same profile reading.
They do not emit a second donation-reset event. The weekly counter's fall is
recorded once, by whichever daily reading sees it first: the player's
profile or their clan's roster.


## Scope: what is actually polled

| Subject | `activity` | `comprehensive` |
|---|---|---|
| Player | profile only | profile and battle log |
| Clan | clan roster, current river race, river race log | the same, plus profile and battle log for **every current member**, following joins and leaves |

Put plainly: **activity follows the clan itself**: its roster, its members
arriving and leaving, and its river races. **Every member also records every
member's battles**, which is what builds the clan a full history rather than a
record of who was in it.

Every role has at least one activity clan slot (member and leader one,
family three, partner ten; [Roles](/docs/roles)), and the first is meant for
your own clan: Elixir follows your primary player's clan in it for you
([Your player's clan](#your-players-clan)). Signup itself starts no
recording. Every member is the upgrade, and
it costs proportionally more to run: the member role has none, so
`elixir_track_clan`, which defaults to `comprehensive`, needs
`scope: "activity"` there.

Players you track are always recorded in full. A recorded player's current clan is
also read for roster and membership tracking, a few times a day, following
the clan's own liveliness, without a slot and without polling the other
members. When nobody tracks that clan, the read keeps only what concerns
the players you track: their membership and role, their roster row, and the
clan's name. The other members, and the clan's own daily numbers, are not
kept. Track the clan to keep them.

**A tracked clan's roster poll records what it carries.** Every clan someone tracks gets
one row per game day of its own numbers (clan score, war
trophies, member count, required trophies, weekly donations), and every member
on that roster gets a row in the same daily series a recorded player's profile
writes, trophies, donations, clan rank, arena and the game's own last-seen,
whether or not their profile is recorded. The two writers share the row: a
member with a recorded profile has the profile's lifetime counters on it too,
and each half is dated by its own reading. The profile's progress buckets
(the seasonal Trophy Road, 2v2 League, Merge Tactics) are kept as a series of
their own; a bucket the player has not touched this season writes nothing, and
the seasonal Trophy Road's entry value (14,000 with best 0) is not a row.
`players_timeline` reads them with `progress_key` (`all`, or one
key such as `seasonal-trophy-road-202609`; an unknown key names the ones the
record holds).

## Relationships, primary, nicknames

Each player you track is your `primary` (exactly one: the first you track unless you name
them a friend or watching, or whichever you mark `relationship: "primary"`), an `alt`, a `friend`, or
someone you are `watching` (the default). The primary is what "omit
`player_tag`" means on your connection, and its current clan is what an
omitted `clan_tag` means. Removing your primary is refused while you track
other players, because Elixir will not choose who "you" are: make another
player primary first (`elixir_track_player` with `relationship:
"primary"`, or the primary control on Players & tracking), then remove the old one.
Removing your last player is allowed, and leaves the account with no
primary until you track one. Claims are taken at your word
(`claim_status: unverified`) until [Verify](/docs/verify) proves one;
several accounts may track the same player and share the recording. A
player another account has verified is theirs: making it your primary or
an alt is refused (`not_entitled`, with what to do), while `friend` and
`watching` are not, and a first player named `friend` or `watching` is
added as that and is not made your primary. If you held a player as your
primary or an alt when another account verified it, your claim ends and
your timeline says so; an ended primary leaves you with none until you
make another player primary.

## Your player's clan

Elixir follows your primary player's clan for you, at activity scope (its
roster, its members coming and going, its river races), as soon as a read
of your player's profile shows which clan they are in. That is what puts
your clan's week in your Monday email. The rules:

- **Only your primary.** An alt, a friend or a player you watch never
  brings their clan with them.
- **Only a player in a clan.** A primary in no clan follows nothing, and
  a primary who leaves their clan leaves your follows as they were.
- **Never past your slots, never in place of a clan you chose.** If your
  activity clan slot is already in use, nothing changes; Players & tracking and
  your player's page offer the clan instead, one click to follow.
- **Never back after you stop.** Stop tracking that clan and Elixir does
  not follow it for you again; you can still track it yourself.
- **It moves with your player.** When your primary joins another clan (or
  you make another player primary), the follow Elixir made moves to the
  new clan, and the old one stops unless someone else records it. A
  clan you followed or changed yourself is never moved.
- Already following the clan, at any scope, changes nothing. Agents never
  follow a clan this way.

The follow comes with a read of your player's profile: usually within a
minute of adding a new player, and otherwise at the next regular profile read. Each
follow Elixir makes is listed under **What changed on your account**, on
Settings › Sign-ins & devices.

`elixir_nickname({ player_tag, nickname })` stores a private label (1 to 40
characters, `null` clears) that only your account, and what you connect as
yourself, sees (an agent is an account of its own and keeps its own);
`players_search` ranks your nicknames first. It is the one write the website's
record page performs.

## Events

Elixir records the game event calendar so you can see which modes and challenges were available when your games happened. `game_events` lists daily sightings in a selected window, the first and latest sighting, and days without a read. These are readings, not announced start/end times.
