---
name: migration
description: Change Elixir's database schema safely. `/migration <change>` sorts a schema change (a column, table, constraint, index, rename, drop or data repair) into its migrations and migrate ops, writes them in the house style, tests them on a scratch database, re-pins the schema fingerprint and hands the result to `/ship`, then runs the backfill and the vacuum after the deploy. `/migration check` reviews the unshipped migrations in the working tree against these rules. Use for any new file under db/migrations, any backfill of existing rows, or the question "migration, op, or Jamie?".
---

# Migrations

The database only moves forward, and on 2026-09-15 it moved too far in
one step. 0099 as first written added a column, updated 468k rows and
rebuilt two indexes in one transaction. It outlived the migrate Lambda's
300 s, and its orphaned backend held the ALTER's lock until every
connection queued behind it: the door was down about 35 minutes
(docs/notes/2026-W38.md, "INCIDENT: 0099's unbatched backfill took the
door down"). Most rules below were learned that morning or one like it.
The invariants are ENGINEERING "The database only moves forward" and
DECISIONS "Schema and migrations"; this is the procedure. `shapes.md`
has each kind of change step by step, the header template, the backfill
op's anatomy and the SQL traps.

**`/migration <change>`** (say, `/migration battle_participant gains the
opponent's deck level`): sort, write, test, re-pin, `/ship`, then
backfill and vacuum. **`/migration check`** is read-only: every
migration not yet on `origin/main`, against this file, before `/ship`.

## Preflight

1. Claim the checkout lease before writing:
   `node AGENT-TEAM/scripts/objective-lease.mjs claim session`. Ids are
   dense (`loadMigrations` refuses a gap or a repeat); the lease stops
   two sessions writing the same next number.
2. Read DECISIONS "Schema and migrations" and the last three migrations;
   size each table you will touch with the read-only `{tables}` op
   (`/ops`); check docs/NOTES.md for a backfill in progress.

## The ladder

- `db/migrations/NNNN_snake_case.sql`, applied only by the migrate
  Lambda (`elixir-mcp-migrate`), which the deploy invokes **before** the
  stack flips; never at handler start, never by hand: "Concurrent Lambdas
  racing migrations is a self-inflicted outage."
- **One transaction per file.** The runner
  (`services/migrate/src/migrate.mjs`) begins, runs the file, records it
  in `schema_migrations` and commits. Never write `begin`/`commit`; `set
  local` lasts exactly the migration; `VACUUM` and `CREATE INDEX
  CONCURRENTLY` refuse a transaction block, so neither is in the ladder.
- **A failure stops the deploy before the flip**; earlier ones stay
  applied under the live code (2026-09-17: 0117 failed after 0113-0116).
- **Applied means immutable.** The runner compares each applied file's
  name and sha256, comments included, and refuses: "history is
  immutable". `db/migrations.sha256` pins every file's sha256, and
  `services/migrate/test/migration-lock.test.mjs` fails `npm run verify`
  on an edited or removed file, or a new file without its line (the
  failure prints the line to add). Until 2026-09-25 only the production
  deploy caught an edit, halfway. Fix forward, even for a comment typo.
  A migration that has not shipped may still change, with its line; one
  that failed was never recorded and may be rewritten (0099, 0117).
- 300 s timeout, reserved concurrency 1; a killed Lambda does not stop
  Postgres. `elixir-mcp-migrate-duration` alarms past 90 s.

## Sort the change first

| The change | The shape (sequences in `shapes.md`) |
| --- | --- |
| New table; nullable column; constant default | one migration, instant |
| Existing rows need a value, large table | nullable column; an op fills it after the deploy; vacuum |
| Index on a large table | its own migration, after the fill |
| NOT NULL, foreign key or CHECK on an existing table | three migrations: NOT VALID, VALIDATE, SET NOT NULL |
| Rename, type change, new key | never in place: new column, write both, fill, move readers, drop later |
| Drop a column or table | a contract migration, after the last reader is gone |
| Delete or rewrite production rows | Jamie first |

"Large" is ENGINEERING's test: "If a migration needs more than a few
seconds of lock, it is an op." `VACUUMABLE` (`ops-diagnostics.mjs`)
names the tables that have needed one; a small table takes its update
in the migration (0158, 0176).

## What the rules test enforces

`services/migrate/test/migration-rules.test.mjs` reads every migration
from 0176 on, comments stripped, and fails when a file holds more than
one of `not valid` / `validate constraint` / `set not null`; changes a
column's type in place (`alter column <c> [set data] type`); drops a
`*_pkey` and adds a primary key; or adds a stored generated column to an
existing table. The 2026-09-25 audit found 0152 validating a CHECK in
the file that added it and 0169 re-keying `war_attendance_day` with a
stored generated column; both stay. DECISIONS: "Lock shapes take three
migrations - NOT VALID, then VALIDATE, then NOT NULL, each in its own
file", since "an ALTER's lock lives to the end of its transaction"
(NOTES 2026-09-17, Phase C). It also fails a migration that alters,
updates, deletes from or indexes a table it did not create without `set
local lock_timeout` (added 2026-09-25: 0172-0175 had none). Size is not
tested: 0099 would pass.

## Expand and contract

The deploy migrates before it flips, so the code serving when a
migration commits is the **old** code. DECISIONS: "Expand-and-contract -
drop a column only after no deployed reader has read it; the migrate
Lambda is the only applier."

**Expand** (the table or nullable column, and the writer that stamps
it, in one deploy); **fill** history with an op, then vacuum; **move the
readers** once it is done (0156: "Readers move to the column only after
the backfill reports done."); **contract** in a later deploy (0150
dropped columns nothing deployed had read since 09-19). Old code breaks
on a NOT NULL column with no default, a CHECK it violates, or a drop or
rename of what it reads. 0169 accepted a minute of failed writes because
the next cumulative poll carried them: an exception, not a pattern.

## Never rewrite a large table

DECISIONS: "Migrations never rewrite a large table - add the column,
fill it with a keyset-batched op, index it in its own migration; never
re-key a large rollup table or change a column type in place."

- Open every migration that alters a table live traffic uses with
  `set local lock_timeout = '5s';`. 0156: the lock is "for an instant;
  behind a long read it would queue ingest. Fail fast instead, and let
  the deploy be retried." (0158, 0169, 0170, 0176 do the same.)
- A constant default is catalog-only (0171); a volatile one such as
  `now()` writes every row. Add nullable and let the writer stamp it.
- An index is a plain `create index` in its own migration once the
  column is filled: SHARE lock, reads go on, writes wait. 0100 built two
  on ~470k rows in "seconds each". It earns its place by a measured plan
  (`{explain_*}`, `{profile_tool}`); 0096 dropped two no plan used.

## The backfill op

A fill on a large table is a migrate op in `services/migrate/src/`,
dispatched in `lambda.mjs` and given its row in the `/ops` catalogue
(`ops-catalogue.test.mjs` fails on either without the other). Anatomy
and two real examples: `shapes.md`. In short: keyset batches in short
transactions, write only rows that change, return a cursor and a real
`remaining`, stay under the 90 s alarm, and write rows, never moments
(DECISIONS: "replays and backfills write rows, never moments").

**Never with a deploy.** DECISIONS: "A backfill that does not vacuum is
not finished - never run a backfill and a deploy together (migrate has
reserved concurrency 1)." A looping op holds the function, so the
deploy's migrate step gets a 429 and the deploy fails (twice on
2026-09-22; Run Elixir MCP, "A long batch against a Lambda"). The lease
guards the checkout, not the cluster: note in docs/NOTES.md when a batch
starts and roughly when it ends. When the op is done, retire it with its
test and driver (b01fc4bb); migrations that name it keep naming it.

## Vacuum after every big write

A bulk UPDATE empties the visibility map, index-only scans fall back to
the heap, and HOT updates never trip autovacuum (0103). On 2026-09-16
Clan pages sat at 8 s on `relallvisible = 0`; on 2026-09-22 a
128,818-row backfill held `clans_participation` at 17.5 s until a
vacuum made it 906 ms. So a big write ends with `{vacuum: {table}}` on
each table it touched, reading `relallvisible` against `relpages`.

## The header and the comments

A shipped file cannot be corrected, so its header is the record:
`-- NNNN: <what changes>.`, then why (the incident, Gym finding or
Jamie's call, dated, with the measured number), then what it does not do
and where that lives, and the lock it takes (template in `shapes.md`;
copy 0156 or 0171-0176). The data is documented on the table itself,
`comment on table` / `comment on column` as 0176 does: what the value
means, which migration added it, what null means. A comment can carry
what a rename would hide (0154 on `clan_score`), and a declined
constraint is written on its column (0108). Comments move no pin.

## The record is lossless

- Battles, snapshots and receipts are the system of record; projections
  rebuild from the S3 payload archive, kept forever. Mark, don't delete
  (0173 keeps a suspect board; readers skip it). Deleting production
  rows is Jamie's call: 0176's ~726 rows were one of "Jamie's twenty
  calls" (NOTES 2026-09-25).
- DECISIONS: "Our enums are CHECKed, API enums stay open - ingest must
  never fail on a value the game adds." No constraint may refuse an API
  fact (the declined `war_week.season_id` FK); count with a census op
  before any VALIDATE (`{enum_census}` preceded 0113-0119).

## Testing

Scratch databases per run on brew `postgresql@17`, no Docker locally
(AGENTS.md rule 9; CI uses a `postgres:17` service). Every database
suite builds its own through the whole ladder (`scratchDb()` in
`services/ingest/test/helpers.mjs`, or `migrate()`), so all run the file.

```sh
node --test services/migrate/test/migration-rules.test.mjs services/migrate/test/migration-lock.test.mjs
npm test -w @elixir-mcp/migrate   # ladder applies, is idempotent; fingerprint
```

**The fingerprint** (`db/schema.fingerprint`) hashes the public schema's
columns, defaults, indexes and constraints as the ladder alone builds
them. Re-pin from a **fresh scratch database, never the dev one**; the
CLI defaults to `elixir_mcp_dev`, so always pass `--url`, and commit the
pin with the migration.

```sh
createdb elixir_mcp_pin
node services/migrate/src/cli.mjs migrate --url postgres://$USER@localhost:5432/elixir_mcp_pin
node services/migrate/src/cli.mjs fingerprint --url postgres://$USER@localhost:5432/elixir_mcp_pin --update
dropdb elixir_mcp_pin
```

**Time it on data of the right size, never on production.** No psql
path reaches the private database: take the size from `{tables}` and
fill a scratch database to it (the 2026-09-18 time-series review built a
synthetic year). A production clone (built once, 2026-09-16) needs
Jamie's go. Live data gets reads and refusal paths only, never a write.

## Hand-off

`/ship` ships it. After the deploy, with nothing else deploying, run the
op to `done`, then `{vacuum}`, through `/ops`, which is also the path
for live diagnostics (`{backends}`; `{terminate_backends}` for an
orphaned backend is a write that can end live queries, so it is Jamie's
call unless a runbook grants it). Readers (`/tool-change` when a tool moves), the index
and the contract follow, each its own change.

**Stop and ask Jamie** before deleting or rewriting production rows,
dropping anything that holds data, a lock of more than a few seconds on
a large table, a clone of production, a constraint that could refuse an
API fact, or anything a DECISIONS declined line covers.

## Standing rules

- Never read `.env` files; the production URL lives only in the Lambda.
- Never apply SQL to production by hand, not even to rescue a failed
  deploy: fix forward with the next number.
- Only `{}` runs the ladder (the deploy's call); a payload whose op key
  the handler does not know is refused with `unknown_op` (2026-09-25).
