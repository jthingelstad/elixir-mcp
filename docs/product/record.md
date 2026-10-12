# The record

*Ratified by Jamie, 2026-10-12, in the sitting that drafted it.*

## What it is for

Elixir keeps a lasting record of a person's Clash Royale play and the
people they play with, because the game itself only answers "what is
true right now": a profile, a roster, the last thirty or so battles.
Elixir polls those answers continuously and keeps them, so that history
exists at all. [Jamie, VISION]

The record exists for a circle: a player, their alts, their friends,
the players they watch, and their clan. "Record players because someone
wants their history." [Jamie, VISION] It is not a census of the game.
"Elixir is the recorder" for that circle "without an autonomous elite
population or game commentary; the top of the ladder and esports are out
of scope." [Jamie, 2026-09-23, 2026-10-02]

## Who it serves

- **The person who tracks.** Tracked means recorded: adding a player or
  a clan is the request, capture starts at the next tick, and there is
  no approval queue. [Jamie, 2026-09-05]
- **Everyone who wants the same subject.** One recording per subject,
  shared by every account that wants it; the widest reason wins; a
  recording stops only when no reason remains. [Jamie, 2026-09-05]
- **Every account.** The record is read by accounts: all recorded game
  data is readable by every account, and account data stays private.
  One page is public: a single battle, so it can be shared. Everything
  else needs a free account. [Jamie, 2026-09-05, 2026-10-12]
- **The verticals and the family.** Ladder, Clan, mail, MCP, the JSON
  API, Drop and poapkings.com all read the same functions over the same
  recorded facts: "shared facts have one derivation". [Jamie, 2026-09-19,
  2026-09-25, 2026-10-02]

## Principles that decide the details

1. **Facts, with their provenance.** Elixir is the system of record for
   game facts, and only collectors write it. What a family app adds (an
   award, a leader's classification of a departure, a Drop score) is an
   attested fact: kept apart, labelled with the app, the attesting
   person, role and time, and visible by its type's rule. [Jamie,
   2026-09-04, 2026-09-25]
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
   belongs to a vertical running under a human's policy (Clan) or to a
   person's own agent, and is always labelled as theirs. [Jamie,
   2026-09-19, 2026-09-20, 2026-10-02, 2026-10-11]
5. **History is kept for what someone tracks, and for a while after.**
   A roster poll of a clan nobody tracks keeps only the tracked players
   on it; a retained battle keeps every participant so a later-tracked
   opponent's history is consistent; battle-stub identities are never
   the recorded population. [Jamie, 2026-09-23, 2026-10-06, 2026-10-07]
   A subject nobody tracks any more is trimmed one year after its last
   tracker leaves, and a later track starts fresh: the subject's own
   series go (profile days, roster rows, its battle log), and any battle
   with a still-tracked participant stays with every participant's
   rollup, because it is their record too. [Jamie, 2026-10-12] Only people's tracking
   records: the maintainer's own "ops" reason is retired, and Jamie
   tracks what he wants from his account like anyone. [Jamie, 2026-10-12]
6. **The record is the trigger.** Timeline moments, mail and Discord
   posts are derived from admitted observations, with the battle that
   caused them named. Replays and backfills write rows, never moments.
   [Jamie, 2026-09-15 to 2026-09-17]
7. **One budget, spent for people.** The fleet shares one Supercell rate
   budget; collectors add resilience, never quota. The session clock is
   the player's schedule. [Jamie, 2026-09-19, 2026-09-28]
8. **The archive is write-once.** Payloads are content-addressed and
   are the rebuild source. History leaves only through a reviewed,
   Jamie-approved manifest. [Jamie, 2026-09-11, 2026-09-22, 2026-10-02]

## What it never does

No autonomous elite population, no leaderboard capture, no game-wide
statistics or meta, no recommendations, no player rating, no imported
judgment from elixir-bot. [Jamie, 2026-09-15, 2026-09-19, 2026-10-02]

## When a person leaves

Account removal deletes the account: claims, nicknames, agents,
connections, mail and usage. The players' game history is public game
data and stays, as any subject's does, until the untracked trim reaches
it. [Jamie, 2026-10-12]

## Open

- **The trim is decided, not built.** Until it ships, nothing is
  trimmed; the limits page says so when it lands.
- **The recorder's status page.** `/data/now` opens with no sign-in. It
  shows the recorder working, not the record, so it is service status
  rather than a public page of the record. `[engineering]` it stays
  public unless it names subjects.
