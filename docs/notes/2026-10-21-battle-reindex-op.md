# 2026-10-21 — {reindex}: battle's indexes rebuilt concurrently, one at a time

Jamie accepted RDS's lowered `shared_buffers` (88 MB, from 180 MB, at the
maintenance restart) and approved the next memory lever the same day:
"Approved: add an ops command to elixir-mcp and rebuild the battle
table's indexes concurrently in production after the 10-23 maintenance"
(#630). The platform review found `battle` holding 92,291 rows behind
indexes sized for many more, left by the bulk deletions: `battle_pkey`
78 MB, `battle_time_idx` 21 MB and `battle_cursor_key` 19 MB (6 scans
since the statistics reset). The hourly battles-by-day series and the
stats totals walk those indexes, so rebuilding them frees more cache
than anything else left.

`REINDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` refuse a transaction
block, and the migrate runner wraps every migration in one, so this is
an op, as `{vacuum}` is (`services/migrate/src/ops-reindex.mjs`).

- **Report** (read): `{"reindex": {"table": "battle"}}`. Each index's
  size, scans, validity, the constraint it backs and the foreign keys
  that use it (`battle_pkey` carries `battle_participant` and
  `player_event`), and a bloat estimate; the heap size and row estimate;
  every invalid index, with `_ccnew` and `_ccold` leftovers marked.
  `npm run op` runs it without the lock.
- **Rebuild** (write): `{"reindex": {"table": "battle", "index":
  "<name>", "apply": true}}`. `REINDEX INDEX CONCURRENTLY` of that one
  index, by its quoted name, after checking it is the table's. It answers
  with the size before and after, the time and the validity after.
  Reads and writes carry on throughout: the rebuild holds SHARE UPDATE
  EXCLUSIVE, which blocks only DDL, vacuum and analyze on the table, and
  at each phase it waits for the transactions already running.
- **Leftovers** (write): `{"reindex": {"table": "battle", "drop_invalid":
  "<name>"}}`. A cancelled or failed `REINDEX CONCURRENTLY` leaves its
  half-built copy behind as an INVALID `<index>_ccnew`, or, after the
  swap, the old index as `<index>_ccold`. Once ready, a leftover is
  maintained by every write. The failure answer lists the table's invalid
  indexes, a rebuild is refused while any exists, and `drop_invalid`
  drops one with `DROP INDEX CONCURRENTLY`. It is refused for a valid
  index or one a constraint needs.

**Timeouts.** The migrate Lambda times out at 300 s (its connections
default to a 285 s statement timeout). The rebuild sets
`statement_timeout` to 240 s, so the function outlives the statement and
can report its leftovers. A statement the Lambda outlived would run on
in Postgres after the Lambda died. `lock_timeout` is 60 s per wait. That
is above every door's, the scheduler's and the timeline sync's statement
timeout (18 to 50 s), so a read in flight never ends the rebuild, and a
long jobs transaction ends it early rather than spending the budget. A
test holds both under the template's Lambda timeout.

**The estimate** needs no extension (`pgstattuple` is not installed). It
sizes a btree built now: the table's `reltuples`, each column's
`pg_stats` width and alignment, and the leaf fillfactor (90). On the
test data it came within 7% of every freshly rebuilt `battle` index.
Deduplication makes a real build smaller than the estimate where keys
repeat, and stale statistics move it either way.

**Tests** (scratch database, `services/migrate/test/ops-reindex.test.mjs`):
60,000 battles, nine in ten deleted. `battle_pkey` is rebuilt valid and
under a quarter of its size, and both foreign keys follow it. A real
leftover comes from a rebuild whose lock wait is cancelled behind an open
writer. While it stands every rebuild is refused, `drop_invalid` refuses
the valid index and drops the leftover, and the rebuild then succeeds.
Every refusal is covered: another table, an index of another table or of
none, apply without an index, an index without apply, an unknown key.

The infrastructure template's comment on `shared_buffers` now cites the
new DECISIONS line instead of calling it the engine default.

No migration, and no contract or JSON API change (MCP 11.13.3, JSON API
3.2.1). The deploy runs no acceptance family, because no tool changed.
The rebuild itself runs after the maintenance restart, one index at a
time, smallest first.
