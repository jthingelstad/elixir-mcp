# 2026-11-11 — A follow costs a slot only when Elixir records the player because of you

Social slice 2 (#760). Jamie, 2026-11-11: quotas are built in from the
start, and "a clan all following each other is flat cost". A player slot
now pays for what Elixir records because of you; following a player it
already records is free.

## What "recorded for another reason" means

Read from the recorder, not from the issue's wording. The planner
(`packages/ledger` `selectEligible`) polls a player's profile and battle
log when the player has an active player recording, or is an open
`clan_membership` of a clan with an active recording at `comprehensive`
scope. An `activity` clan polls only its roster. So a follow is free when
either holds:

- **`in_recorded_clan`**: the player is a current member of a clan Elixir
  records at `comprehensive` scope, whoever tracks it;
- **`followed_by_others`**: the earliest counting claim on the player
  (ordered by `created_at`, then `account_id`; an agent counts only while
  approved, the `COUNTS` predicate recording already uses) belongs to an
  account outside your pool.

The first follower pays. Without that tie-break two accounts could each
make the other's follow free and record without limit. An `activity` clan,
the automatic follow of your primary's clan included, records no members,
so following its members costs a slot; the issue's "players in your clan
are free" holds only for a clan recorded in full.

`playerCostSql` in `packages/claims/src/pool.mjs` is the one statement of
the rule. `pooledUsage` counts `players_used` (costing a slot),
`players_free` and `players_followed` from it, in SQL. `COUNTS` moved
into `pool.mjs` so recording and paying share one text. No migration: the
reads use `clan_membership_one_open_per_player` and
`recording_one_active_per_subject`, and `claim` has about fifty rows; an
index on `claim (player_tag, created_at)` waits for a measured plan.

## Measured before building (read-only, 2026-11-11)

- 24 hours of collector receipts: 1,876 fetches against a ceiling of
  86,400 a day (2.2%). Player profiles 149, battle logs about 1,280, for
  69 recorded players (36 by direct player recordings, the rest through
  12 recorded clans).
- One recorded player costs about 21 fetches a day (about 18.5 battle-log
  reads and 2.2 profile reads), 0.024% of the ceiling. A full pool of 50
  slot-costing players is about 1,035 a day, 1.2%.
- 51 claims across 58 accounts; no account but the owner's holds more
  than 7, and nobody is near 50. 51 claims on about 36 directly recorded
  players: at most 15 claims are on a player someone else also claims.
  How many claims are of members of a comprehensive clan could not be
  read without a new op; `tier_census` reports the new counts once
  deployed.

No account's count rises: a player costs a slot under the new rule only
when it did under the old one.

## Defaults taken [engineering, 2026-11-11]

- At the limit a slot-costing follow is refused, never queued, with the
  reason: used of limit, and that following a player Elixir already
  records stays free.
- Still 50 slots below admin.
- A free follow whose reason goes away keeps recording and starts
  counting. Nobody is forced off; over the limit only a new follow that
  would take a slot is refused, and free follows still go in.
- The global rate budget and ceiling do not move.
- The daily first-read allowance stays one per slot (`player_slots`),
  unchanged.

## Surfaces

- `elixir_track_player` returns `slot` (`took`, `free`, `free_because`,
  `used`, `limit`) and a note saying which; its `quota_exceeded` message
  and hint name the way out. MCP 11.19.0, additive.
- `POST /api/v1/me/players` mirrors the tool: JSON API 3.5.0.
- Web: `GET /api/me/follow-cost` (agent-scoped too) prices a tag before
  the tap; search's Follow, Home's Follow a friend and Settings' Track a
  player show "Free · already recorded" or "Uses 1 of your 50 player
  slots · N used". `/api/me` marks each claim `slot: free | used` and
  `entitlements.player_slots.free`; Players & tracking shows both, and
  Usage's row is now "Player slots used".
- Docs: Recording's "What a player slot costs", Limits, Follow a friend,
  Glossary, Roles; DECISIONS gains the line and amends "Roles never gate
  visibility".
