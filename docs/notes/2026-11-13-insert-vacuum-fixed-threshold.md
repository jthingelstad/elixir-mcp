# 2026-11-13 — Insert-driven vacuum at a fixed count (0253)

Autovacuum had not vacuumed `battle`, `battle_participant` or
`player_snapshot_daily` since 2026-11-08/09: their insert trigger (1,000
plus 2% of the table on the battle tables from 0103, the default 20% on
the snapshot table) takes days to reach at today's sizes, and HOT pruning
keeps dead tuples under the dead-tuple trigger. The newest pages, the
ones the index-only reads (0249, 0250) read, fell out of the visibility
map and the reads fetched the heap (1,985 heap fetches before a manual
`{vacuum}`, 8 after; note 2026-11-13-participation-reads-cheap).

0253 sets `autovacuum_vacuum_insert_scale_factor = 0` with a fixed
`autovacuum_vacuum_insert_threshold` of about one day's inserts: `battle`
500, `battle_participant` 1,000, `player_snapshot_daily` 500 (sized from
`{tables}` and the public stats series on 2026-11-13; the migration's
header has the numbers). An insert-driven vacuum visits only pages not
already all-visible and skips index cleanup when little is dead, so a
daily run is cheap on the db.t4g.micro. 0103's dead-tuple and analyze
settings stay. No manual vacuum was run for this change.

Check a week on with `{tables}`: `last_autovacuum` within a day and
`all_visible_pct` above about 98 on each table.
