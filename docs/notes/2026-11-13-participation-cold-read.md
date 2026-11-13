# 2026-11-13 — First reads after a deploy: participation and the timeline (0261, 0262)

## Before

The acceptance gate's `clans_participation` (weeks 2, a 50-member clan)
took 8 to 10 s on its first call after a deploy and 0.7 to 1.0 s warm,
against an 8 s ceiling; it failed five of the last six deploys. Its
heaviest statement was `members`, about 694 ms warm and 33,000 buffers.
`elixir_timeline`'s first read took 6 to 11 s.

Measured on a synthetic year (100k+ battles, 900 players, 20 clans, a
year of day rows one to a heap page), each statement EXPLAIN (ANALYZE,
BUFFERS) after evicting the database's pages:

- `members` and `former_members` ask for each member's last battle in
  the clan with `bp.clan_tag = cm.clan_tag`. The player/time cover and
  the clan/time index cost within a hundredth of each other for it, so
  the planner may take either. On the clan index, a member with no recent
  battle in the clan walks the clan's history back to their last one,
  once per member: 70,000 buffers on the synthetic year, against 1,100
  on the player's own range. That is the live 33,000.
- The capture estimate (`captureByPlayer`, `player_tag = any(...)`) read
  `profile_observed_at` and `battle_count` from the snapshot heap: 4,131
  buffers, 384 from disk, and counted every interval's battles twice.
- The timeline read each followed player's last profile before the
  window's start and end with no index on `profile_observed_at`: every
  day row of the player from the heap, then a sort. About 21,600 buffers
  per statement for 55 followed players, twice: 43,000 of the call's
  71,000 buffers and nearly all its disk reads.

## What changed

- `lastBattleInClan` (participation-sql.mjs) writes the clan test as
  `bp.clan_tag is not distinct from cm.clan_tag`. That is not an index
  condition, so the clan index cannot serve it and each member is one
  range of `battle_participant_player_time_cover`. `cm.clan_tag` is never
  null, so the rows are the ones `=` matched.
- `captureByPlayer` reads one key range per distinct member inside a
  lateral, and counts each interval's battles once. 0261 widens 0250's
  snapshot cover with `profile_observed_at` and `battle_count`
  (`player_snapshot_daily_week_cover`) and drops 0250's, so the read is
  index-only. Profile-read updates are no longer HOT.
- 0262 indexes `player_snapshot_daily (player_tag, profile_observed_at
  desc) where profile_observed_at is not null`. The timeline's statement
  is unchanged and now probes it: 220 buffers per statement.

Synthetic year, cold, buffers (from disk):

| Read | Before | After |
| --- | --- | --- |
| participation `members` on the clan index | 2,689 (775) | 691 (209) |
| participation capture estimate | 4,131 (384) | 2,143 (208) |
| participation, whole call | 6,464 | 4,477 |
| timeline last profile, each of two | 21,600 (21,450) | 220 (112) |
| timeline, whole call | 71,418 | 25,425 |

Every answer is unchanged: the tool bodies before and after are equal
but for the clock. `cold-read-plan.test.mjs` pins the rows against the
old statements, the index each read enters, no read on the clan index,
the loops, and buffer ceilings (at least ten times fewer than the old
plan); `participation-plan.test.mjs` follows the cover's new name.

## Also

`packages/record/src/member-activity.mjs` has the same `player_tag = $1
and clan_tag = $2` last-battle read. It is Clan's, and was left alone.
