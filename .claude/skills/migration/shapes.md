# Shapes

Each kind of schema change, in order, named by the migration that did it
first. Read that migration before writing yours. Every migration below
that alters a table live traffic uses opens with
`set local lock_timeout = '5s';` (0156).

## The header

```sql
-- NNNN: <what changes, in one line>.
--
-- <Why: the incident, Gym finding (#n) or Jamie's call, with its date,
-- and the number that was measured.>
--
-- <What this does not do and where that lives ("history is filled by
-- the migrate op {x}, not here"; "readers move once it reports done"),
-- and the lock it takes and why that is safe.>

set local lock_timeout = '5s';

alter table <table> add column <column> <type>;

comment on column <table>.<column> is
  '<What the value means, where it comes from (NNNN), what null means.>';
```

## A new table or a nullable column (0172)

One migration; catalog-only. A constant default is fine (0171, 0173); a
volatile one (`now()`, a random value) writes every row. The writer that
stamps it ships in the same deploy. Re-pin the fingerprint.

## A value for the existing rows of a large table (0099, 0156)

1. Migration: the column, nullable, no default.
2. The writer (usually ingest) stamps it from the same deploy on.
3. After the deploy: the backfill op, to `done` (below).
4. `{vacuum: {table}}` on every table it wrote.
5. The readers move, as their own change.
6. If it should be NOT NULL, the three steps below.

## An index on a large table (0100)

Its own migration, after the fill, so the backfill does not churn it: a
plain `create index`, which holds a SHARE lock (reads go on, writes
wait); 0100 built two on ~470k rows in seconds each. Changing an
index's INCLUDE list is a drop and a create in one file (0098, 0100).
Build one only for a plan you measured (`{explain_*}`, `{profile_tool}`).

## NOT NULL on an existing column (0115, 0116, 0117)

A direct `set not null` scans the table under ACCESS EXCLUSIVE, so the
proof is a CHECK, and each step is its own file:

```sql
-- step one: instant, scans nothing
alter table t add constraint t_c_nn check (c is not null) not valid;
-- step two: scans under SHARE UPDATE EXCLUSIVE; no read or write waits
alter table t validate constraint t_c_nn;
-- step three: proven by the check, no scan (PostgreSQL 12+); the check goes
alter table t alter column c set not null;
alter table t drop constraint t_c_nn;
```

Before step two deploys, a read-only census says there are 0 nulls
(`{enum_census}` did it for 0115-0119).

## A foreign key or a CHECK (0108 then 0113; 0118, 0119)

NOT VALID in one migration (instant), VALIDATE alone in the next. A
CHECK is for our own enums only; the API's stay open. Never an FK that
could refuse an API fact at ingest (the declined `war_week.season_id`
key; 0108's header says why). Replacing a CHECK is a drop and an add
NOT VALID in one file (0175); its VALIDATE is a later file.

## A rename, a type change or a new key (0123 then 0125)

Never in place: `alter column ... type` rewrites the table and a re-key
rebuilds it, and the rules test refuses both. Add the new column under
a new name, have the writers write both, fill it, move the readers, then
drop the old one in a contract migration (0123 "the expand half", 0125
the drops). 0125 renamed the new column into the old name as it dropped
the old: that rename is itself a change the live code must survive
during the flip. A new key is a new table keyed right, filled, read,
and the old one dropped later.

## A drop (0150; 0169 then 0170)

A contract migration, once the code that stopped reading and writing it
is already live from an earlier deploy. Carry over anything the old code
wrote during the flip first (0170). Dropping anything that holds data is
Jamie's call. Space comes back only with `{rewrite_table}` (0097), a
deliberate exclusive-lock op over a closed list of three tables.

## Deleting or repairing rows

A small table takes it in the migration (0158, 0176). A large one takes
an op. Deleting production rows is Jamie's decision; prefer marking a
row and having readers skip it (0173's `superseded_at`).

## The backfill op

Read two real ones first:

- `seriesBackfill` in `services/migrate/src/ops-series.mjs` (live): the
  cursor in a state table (`series_backfill_state`, 0131), S3 reads
  before the transaction opens, a batch retried on deadlock, and a local
  driver, `infra/scripts/series-backfill.mjs`.
- `oppLevelBackfill` for 0156 (retired): `git show
  b01fc4bb^:services/migrate/src/deck-backfill.mjs`, and its test at
  `b01fc4bb^:services/migrate/test/opp-level-backfill.test.mjs`. A
  returned cursor, one statement per batch, a 45 s budget.

The anatomy:

- **Registered** in `services/migrate/src/lambda.mjs` like every op, as
  `if (event?.<name>) { ... }` above the final fall-through to
  `migrate()`, taking `event.<name> === true ? {} : event.<name>`, with
  its row in `.claude/skills/ops/ops.md` in the same commit
  (`services/migrate/test/ops-catalogue.test.mjs` compares the two), and
  both leave together when the op retires.
- **One connection, one query at a time.** ENGINEERING, "One client is
  one connection": `services/mcp/test/pg-usage.test.mjs` fails on a
  `Promise.all` over `db.query` anywhere in service source. S3 reads may
  run concurrently, before the transaction opens.
- **Keyset on the primary key**: `where <key> > $1 order by <key> limit
  $2`, each batch one statement or one short transaction.
- **Write only what changes**: `and t.<column> is null`, or `where
  (current) is distinct from (resolved)`. A re-run, an overlap with
  ingest and a resumed cursor then converge, and a re-run writes nothing.
- **A budget, a cursor and a real remaining count.** Loop batches until
  `budget_ms`, then return `{batches, filled, after, done, remaining,
  ms}`; the caller passes `after` back until `done`. 45 s stays clear of
  the 90 s `elixir-mcp-migrate-duration` alarm, which `{series_backfill}`'s
  240 s default trips. A real `remaining` lets anyone tell done from
  stuck (Run Elixir MCP).
- **Deadlocks retry.** A batch Postgres picks as the victim (`40P01`) is
  replayed after a beat. Smaller batches overlap ingest less: the series
  backfill went from 200 receipts a transaction to 50 after its first
  live run deadlocked against a collector submission (2026-09-17).
- **Rows only.** Never the membership machine, events, anchors or
  `poll_state` (the series backfill's rule; DECISIONS "The record is the
  trigger": "replays and backfills write rows, never moments").
- **A test** in `services/migrate/test/` on a scratch database: seed, run
  with a tiny batch, assert it resumes by cursor and that a re-run
  writes nothing.
- **Vacuumable.** A table it writes that `VACUUMABLE` lacks joins the
  list in the same change.

Run it after the deploy, never beside one: by hand, passing `after`
back, or with a driver loop. Then `{vacuum}`. Then retire it (b01fc4bb).

## SQL traps

- A `$n` used twice takes its type from its first use. `dailySql`'s
  `($2)::date` made every later `battle_time >= $2` compare against
  midnight (NOTES 2026-09-21, "dailySql's DATE-typed parameter"). Cast at
  every use.
- Postgres refuses a bound parameter the statement never uses (notes
  2026-09-09: the meta tools' "failed unexpectedly").
- `on conflict do update` without a `where` writes a new tuple version
  for every conflicting row even when nothing changed (ENGINEERING,
  "Ingest invariants"). The `is distinct from` guard is also what makes a
  backfill's re-run free.
- NOT VALID skips only the rows already there: every write after the
  commit is checked, the old code's during the flip included.
- A bare `::date` or `current_date` over a `timestamptz` is a UTC day,
  because 0155 pins the database's session zone; a caller's zone goes in
  SQL with `at time zone`, never by setting the session.
- node-pg returns `bigint` and a bare `count(*)` as strings; the ops cast
  counts `::int`.
