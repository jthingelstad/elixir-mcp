# 2026-11-13 — The visibility-map trap cannot pass a deploy unseen

## What happened

The data layer refactor rewrote `battle_participant` and `battle`
(`{card_arrays}` filled every row, then `{rewrite_table}` ran VACUUM
FULL on each). Afterwards `pg_class.relallvisible` was 0 for both
(11,735 and 2,739 pages), so no read could be index-only:
`clans_participation`'s last-battle statement fetched 58,767 heap pages
for 48 members and took 10 to 22 s on a cold db.t4g.micro, failing the
deploy's acceptance gate six times. `{vacuum}` fixed it in 7 s: 61,843
buffers to 1,053, 10.6 s to 387 ms. The second time (the first was a
HOT backfill on 2026-09-16, 0103).

Two things made it quiet. VACUUM FULL writes a new heap with an empty
visibility map (checked on PostgreSQL 17: 885 pages, `relallvisible`
885 after a VACUUM, 0 after a VACUUM FULL, 885 again after the next
VACUUM). And nothing autovacuum watches moves: a rewrite leaves no dead
tuples, so only 0253's insert trigger (500 and 1,000 inserts, about a
day of each table's inserts) would have caught it, a day later.

## What changed

- **Detect.** `{visibility_check}`, a read-only migrate op
  (`services/migrate/src/vacuum.mjs`), lists every ordinary public table
  with 500 heap pages or more and under half of them all-visible
  (`visibility_map`), or with 10 pages or more and never analyzed
  (`never_analyzed`, reltuples -1) or estimated at 0 rows while live
  rows are counted (`stale_estimate`), each with the `{vacuum}` command.
  Pages are the heap's size now, not `relpages`, which a table filled
  since its last analyze reports as 0. A read-only transaction, 30 s
  statement and 5 s lock timeouts. The deploy runs it after smoke and
  before acceptance (`visibility` phase, `infra/scripts/lib/
  visibility-check.mjs`) and prints one line per table:

  ```
  WARNING: battle_participant: 0 of 11735 pages all-visible (0%); index-only reads fetch the heap. After the deploy run: npm run op -- '{"vacuum":{"table":"battle_participant"}}'
  ```

  It never fails the deploy and never writes; an invoke error or an
  older migrate bundle is one WARNING line. By hand:
  `npm run op -- '{"visibility_check": true}'` (a read, no lock).
  Thresholds: half, because under half an index-only scan fetches the
  heap for most of what it reads and a healthy table under 0253 sits
  near 98; 500 pages, because a smaller table costs few reads and a
  churny small one would warn on every deploy.
- **Prevent, migrations.** A migration names the tables it bulk-writes
  or rewrites in one comment line, `-- vacuum after: <table>, ...`. The
  runner reads it at load (a name that is not a plain identifier stops
  the load) and, after the last pending file commits, runs VACUUM
  (ANALYZE) on each declared table once, on the ladder's connection,
  until the Lambda's end less 30 s and at most 120 s a table. A vacuum
  that fails or does not fit is in the answer's `vacuumed` and a deploy
  WARNING with its `{vacuum}`, never a failed ladder. With nothing
  pending the answer is `{applied, ran}` as before.
  `services/migrate/test/vacuum-after.test.mjs` fails verify for a
  migration from 0263 on whose SQL updates, deletes from, insert-selects
  into, creates-as-select, adds a function-call default column to, or
  changes a column type of a table it does not declare. It asks for any
  table, small ones too (a vacuum of a small table costs milliseconds;
  the test cannot know production's sizes). It skips function bodies
  (not a DO block's) and `insert ... values`, and cannot see dynamic SQL
  or a write inside a called function; the skill says to declare those
  by hand. Run over the shipped ladder it finds the known bulk writes
  (0093, 0123, 0210, 0234 among them); earlier files are immutable and
  not checked.
- **Prevent, ops.** `{rewrite_table}` follows its VACUUM FULL with a
  plain VACUUM (ANALYZE) (`vacuumed`; at most 45 s, never past 285 s of
  the op), and `{read_facts_backfill}` vacuums `admitted_read_day` and
  `battlelog_read_gap` in the batch that reports `done`. The
  `{card_arrays}` fill retired with 0256.
- **Allowlist.** `{vacuum}` takes any ordinary table in the public
  schema whose name is a plain lower-case identifier, checked against
  the catalog, and quotes it. The hand-kept `VACUUMABLE` list is gone:
  it could not name every table the check can, and a plain VACUUM
  changes no row and takes a lock reads and writes do not wait on, so
  no table needs keeping out. `{rewrite_table}` (VACUUM FULL, an
  exclusive lock) keeps its closed list. 240 s statement and 10 s lock
  timeouts; a failure answers `vacuum_failed` with its SQLSTATE.

## Autovacuum settings: no new migration

0253 already gives the three tables with index-only reads
(`battle`, `battle_participant`, `player_snapshot_daily`) a fixed
insert trigger of about a day of inserts with a zero scale factor, and
0189 gives `deck` its 2% trigger. Inserts alone do keep their maps fresh
day to day; what they cannot do is notice a rewrite sooner than the next
threshold, and a lower threshold only shortens the lag (100 on
`battle_participant` would be about ten autovacuums a day, each a
pass over the pages the map misses, on a 1 GB instance with about 100 MB
to spare) without closing it. The fix for a rewrite is the vacuum the
rewrite now runs itself. The two read-fact tables take a few hundred
upserts a day and are read by key with their arrays from the heap, so
an index-only read does not depend on their maps.

## Not here

No migration, no stored data touched, no contract, tool or web change,
no What's new entry. Tests: `services/migrate/test/vacuum.test.mjs` (the
check, the op, the rewrite's vacuum and the ladder's, on scratch
databases with autovacuum off on the probe tables),
`vacuum-after.test.mjs`, `services/mcp/test/visibility-check.test.mjs`
(the deploy's lines and that it never throws).
