# clans_participation and clan.most read cheap (0250, #649)

2026-11-13.

## Before

`clans_participation` is read by the MCP tool, Clan's pages and the Home
clan-card rebuild. Warm it takes about 350 ms (127 ms in the database);
cold it took 2 to 5 s, and Clan's own calls ran p50 1.4 s, p95 11.3 s
over three days to 2026-11-13. The cold cost was pages read from disk,
about 4,600 for POAP KINGS' eight weeks (`{explain_participation}`):

- donations: about 2,650 heap pages of `player_snapshot_daily`, where a
  member's day rows sit one to a page;
- former members' battles: a bitmap over the clan's window on
  `battle_participant` and its heap, 550 pages for 17 players;
- `war_participation`: a sequential scan of the whole table, 477 pages.

`clan.most` (the clan entry's standouts) joined `player` before counting
and seq-scanned it, 37,817 rows (note 2026-11-13-battle-timeline-cover).

## What changed

- 0250 builds `player_snapshot_daily_donations_cover` on
  `(player_tag, snapshot_date)` including `snapshot_kind, donations,
  clan_tag`, so the per-member donation read is index-only. About 1 MB.
  Updates that change donations are no longer HOT.
- Both battle counts read one index-only range of the player/time cover
  per distinct member, grouped inside a lateral, as donations already
  did. No `player_tag = any(...)` reads a batch.
- `war_participation` reads each window week's primary key range, then
  filters the tags.
- `clan.most` counts per member first and names each by primary key
  through a lateral (`clanMostQuery`, now also in `{explain_timeline}`).

Every answer is unchanged. Plan tests pin rows equal to the old
statements and the new access paths: `participation-plan.test.mjs`,
`clan-most-plan.test.mjs`.

## Also

- `battle` and `battle_participant` were vacuumed through `{vacuum}` on
  2026-11-13 (00:51Z); heap fetches in the participant reads fell from
  1,985 to 8. Autovacuum had not touched either since 2026-11-09: their
  insert threshold (1,000 + 2% of the table) is crossed rarely and HOT
  pruning keeps dead tuples near zero, so the recent pages, the hot
  ones, stay not all-visible. A per-table
  `autovacuum_vacuum_insert_scale_factor = 0` with a fixed threshold, or
  a daily `{vacuum}`, would keep them visible. Not changed here.
- `rosterHistoryQueries` and coverage's `captureByPlayer` still read
  `player_tag = any(...)` on small tables; left alone.
