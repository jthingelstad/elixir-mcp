# The record

*Rewritten 2026-11-13 to the social layer, from the brief Jamie ratified
on 2026-10-12, under [`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. Ratified by Jamie, 2026-11-13
("I think the rest is good to go").*

## What it is for

The record is what the social layer is built on. The game only answers
"what is true right now": a profile, a roster, the last thirty or so
battles. Elixir's collectors poll those answers continuously and keep
them, so that there is a history to follow at all: sessions, moments,
highlights and seasons. "The game does the playing, collectors record
it, and Elixir is the place where people see it, follow each other and
celebrate." [Jamie, 2026-11-11, `VISION.md`]

The record exists for a circle: a player, their alts, the people they
follow, and their clan. "Record players because someone wants their
history." It is not a census of the game: no elite or pro tracking, no
leaderboards, no game-wide statistics. [Jamie, VISION, 2026-09-23,
2026-10-02, 2026-11-11]

## Who it serves

- **The person who follows.** Following is recording: adding a player or
  a clan is the request, capture starts at the next tick, and the last
  thirty battles arrive with the first profile read. There is no approval
  queue. A follow takes a slot only when Elixir records the player
  because of you. [Jamie, 2026-09-05, 2026-11-09, 2026-11-11]
- **Everyone who wants the same subject.** One recording per subject,
  shared by every account that wants it; the widest reason wins; a
  recording stops only when no reason remains. [Jamie, 2026-09-05]
- **Every member.** Every read of the record needs an account, and every
  signed-in member reads all of it; account data stays the account's. A
  battle link someone sends and a post its owner shares open without an
  account, with their link previews. [Jamie, 2026-11-11, "Everyone signs
  in; shared posts stay public"]
- **Every surface.** Home, the player page, Stats, Clan, mail and MCP
  read the same functions over the same recorded facts:
  "shared facts have one derivation". [Jamie, 2026-09-19, 2026-09-25,
  2026-10-02]

## Principles that decide the details

1. **Facts, with their provenance.** Elixir is the system of record for
   game facts, and only collectors write it. What Clan adds (an award, a
   leader's classification of a departure) is an attested fact: kept
   apart, labelled with its source, the attesting person, role and
   time, and visible by its type's rule. A player's highlight is their
   own words beside a recorded battle, never a change to it. Drop writes
   nothing. [Jamie, 2026-09-04, 2026-09-25, 2026-11-11, 2026-11-13]
2. **Absence needs proof.** A missing capture, observation or profile
   clan is unknown, never zero. Quiet days count only where complete
   reads bracket them. No recorded battles is not proof of no play.
   [Jamie, 2026-09-15; engineering, 2026-10-08]
3. **The game's own units.** Modes are different games and are never
   pooled without saying so; the game day is the 10:00Z grid; war facts
   are the race's weekly aggregates, never a per-day split; a duel is
   its rounds; a boat defence is not the member's battle; tags are the
   only game identifiers. [Jamie, 2026-09-03 to 2026-09-28]
4. **Facts are not judgments.** The record reports; it rates no player,
   recommends nothing, and names decks without judging them. Judgment
   belongs to a clan running under its leaders' policy (Clan) or to a
   person's own agent, and is always labelled as theirs. [Jamie,
   2026-09-19, 2026-09-20, 2026-10-02, 2026-10-11]
5. **History is kept for what someone follows, and for a while after.**
   A roster poll of a clan nobody follows keeps only the followed players
   on it; a retained battle keeps every participant so a later-followed
   opponent's history is consistent; battle-stub identities are never
   the recorded population. A subject nobody follows any more is trimmed
   one year after its last follower leaves, and a later follow starts
   fresh: the subject's own series go (profile days, roster rows, its
   battle log), and any battle with a still-followed participant stays
   with every participant's rollup, because it is their record too. Only
   people's following records. [Jamie, 2026-09-23, 2026-10-06,
   2026-10-07, 2026-10-12]
6. **The record is the trigger.** Timeline items, mail and Discord posts
   are derived from admitted observations, with the battle that caused
   them named. Replays and backfills write rows, never moments. [Jamie,
   2026-09-15 to 2026-09-17]
7. **One budget, spent for people.** The fleet shares one Supercell rate
   budget; collectors add resilience, never quota. The session clock is
   the player's schedule. [Jamie, 2026-09-19, 2026-09-28]
8. **The archive is write-once.** Payloads are content-addressed and
   are the rebuild source. History leaves only through a reviewed,
   Jamie-approved manifest. [Jamie, 2026-09-11, 2026-09-22, 2026-10-02]

## What it never does

No elite or pro population, no leaderboard capture, no game-wide
statistics or meta, no recommendations, no player rating, no named
recording collections, no imported judgment from elixir-bot. [Jamie,
2026-09-15, 2026-09-19, 2026-10-02, 2026-11-11]

## When a person leaves

Account removal deletes the account: claims, nicknames, highlights,
agents, connections, mail and usage. The players' game history is game
data and stays, as any subject's does, until the unfollowed trim reaches
it. [Jamie, 2026-10-12]

## Open

- **The trim is decided, not built** (#528). Until it ships, nothing is
  trimmed.
- **The cost of each followed player**, and the limits that keep about a
  thousand people affordable (VISION, Open). Default in force: 50 player
  slots at every tier, a follow costing one only when Elixir records the
  player because of you.
- **The recorder's status.** `/data` and `/api/public/status` open with
  no sign-in. They count the recorder working, not the record, so they
  stay public while they name no subject, with one exception: each
  collector is credited to its operator's primary player. [Jamie,
  2026-10-12]
