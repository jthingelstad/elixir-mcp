# 2026-11-13 — One verify run holds a bounded share of the local Postgres

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes. Tests and the test harness only.

Several sessions run `npm run verify` on one Mac against one brew
PostgreSQL (`max_connections` 100). Twice on 2026-11-13 a verify failed
with "sorry, too many clients already" in suites the change never
touched. One run, sampled from `pg_stat_activity` every 0.2 s, peaked at
49 and 53 connections; two runs at once exhausted the server.

## What held the connections

- **About 80 test files made their own database and ran all 244
  migrations into it**, instead of cloning the migrated template
  `scratchDb()` already kept. Each held an admin connection through the
  ladder, and the ladder's writes slowed every other file's queries.
- **Nothing bounded how many files held a database at once.**
  `test.mjs` ran five units, and `node --test` ran up to nine files in
  each (cores minus one), so up to 45 scratch databases were open.
- **Each web handler's pool kept up to four connections**, and
  `web-api.test.mjs` alone made seven handlers.

## What changed

- **Every scratch database is a template clone.**
  `packages/ingest/test/helpers.mjs` exports `createScratch(name)` and
  `dropScratch(name)`; the hand-written create, migrate and drop blocks
  call them. The template is built once per migration set (as
  `scratchDb()` already did). Five files keep a bare database because
  they test the ladder itself (a partial set, a rerun, a retired schema).
- **A run holds at most ten scratch databases at once.**
  `infra/scripts/test.mjs` makes a slot directory per run and passes
  `ELIXIR_TEST_DB_SLOTS_DIR` and `ELIXIR_TEST_DB_SLOTS` (`--db-slots N`,
  default 10). `createScratch` waits for a free slot (an atomic `mkdir`);
  a slot whose process died is taken back by its pid. A focused
  `node --test` outside `test.mjs` has no cap.
- **Pools keep two connections under the runner** (`DB_POOL_MAX=2`, the
  handlers' own setting; production is unchanged).
- **vitest waits for its slot in `globalSetup`**
  (`apps/web/test/global-setup.mjs`, `holdSlot()`). A queue for slots
  inside the journeys' timed `beforeAll` read as a 60 s setup failure;
  `globalSetup` has no timeout, and its workers inherit the slot.
- **`node --test --test-force-exit`** in every workspace's test script.
  In 37 places a test opens a second client before its `try`, so a failed
  connect (exactly "too many clients") left the scratch client open and
  the file's process alive forever, holding its slot: a failure read as
  a hang. A file now ends when its tests do.

## The three timing-sensitive tests

- **`apps/web/test/account-journeys.test.jsx`.** Idle, `POST
  /api/claims` takes 44 ms: database queries only, behind the page's
  five GETs on the pool. Its 5 s wait was spent in a Postgres slowed by
  the suite itself (the migration ladders above, a WAL-logged clone per
  file, a forced checkpoint per `DROP DATABASE`) and in connections
  opened inside the wait (1.2 s each, #935). The template clones and the
  cap remove most of that load, and `warmPools()`
  (`services/web-api/test/warm-pools.mjs`) opens the handler's pool in
  setup. Create and drop stay per file: PostgreSQL 17 checkpoints on
  every `DROP DATABASE`, and the cap bounds how many run at once.
- **`services/mcp/test/query-budget.test.mjs`** asserted wall-clock
  time (`< 5000`, `< 2000`, `< 500` ms). The budget tests now assert
  what load cannot move: the server's own outcome for the statement
  (SQLSTATE 57014, canceled, or 55P03, lock not available), recorded by a
  query-only wrapper, and for work outside the database a gate the test
  releases after the answer instead of a timer.
- **`services/web-api/test/public-signup.test.mjs`**, the concurrent
  sign-up test, asserts no time. A deterministic hold before each of one
  request's queries found no ordering that answers other than 200, 200
  and one welcome: no product race. Its load sensitivity was the doors'
  connection bound (2.5 s, tried twice) for a connection opened inside
  the test; `warmPools()` opens both handlers' pools in setup.

## Measured

| Run | Peak connections (this run) | Wall time |
| --- | --- | --- |
| Before | 49, 53 | 78 s, 79 s |
| After (ten slots, pools of two) | 22, of which 10 are `web-api.test.mjs`'s seven handlers | 80 s, at a host load of 17 to 35 |
