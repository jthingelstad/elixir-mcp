# battle_timeline_cover (0249, #649)

2026-11-13.

## Before

Acceptance timed `elixir_timeline#1` (King Thing, seven days) at about
10.5 s. Warm, through `{profile_tool}`, the same call took 2,054 ms (46
queries, 1,850 ms in the database). The slowest warm read was `clan.most`
(1.2 s in one run and 0.54 s under EXPLAIN, mostly a seq scan of `player`).
`{explain_timeline}` for POAP KINGS' week showed `clan.member_battles`
fetching every battle row from the heap through `battle_pkey` for
`game_mode_name` and `boat_battle_side`: 3,442 loops, about 13,800
buffers. The 10.5 s is the cold-cache cost of reads like that one on a
145 MB heap.

## What changed

0249 builds `battle_timeline_cover` on `battle (battle_id)` including
`battle_time, created_at, type, event_tag, game_mode_name,
boat_battle_side`, and drops 0227's `battle_metadata_cover`. The new index
has the same key and a superset of its columns. On a scratch database at
production size (130,000 battles, 127 MB heap), the member-battles read
became an index-only scan of the new index with 0 heap fetches. The index
is 14 MB.

## Left alone

- `battle_participant` was not reindexed, and no op was added.
- Heap fetches stay high on recent rows: 2,774 of 3,084 in `clan.most`.
  Pages written since the last autovacuum (2026-11-09) are not yet
  all-visible. `{tables}` reports `battle` as 100% all-visible because that
  figure comes from `relallvisible`, which is stale. `relallvisible` was not
  0, so `{vacuum}` was not run.
- `clan.most` seq-scans `player` (37,817 rows, three loops). This is a
  separate fix.
