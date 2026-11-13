# 2026-11-13 — Web tests hold under load; a deploy never modifies a tracked file; acceptance records its cost

Three fixes from one evening of many deploys and verify runs at once
(load average about 42). No contract, API or migration change.

## Web tests under load

`first-answer`, `player-page`, `app` and `account-journeys` timed out on a
loaded host. Three causes, none of them a short timeout:

- **Lazy route chunks compiled inside the waits.** Each route in
  `apps/web/src/App.jsx` and `src/clan/routes.jsx` is a `lazyRouteComponent`.
  Vitest transforms a chunk on its first import, which was inside the first
  test's `findBy` and its timeout. `apps/web/test/warm-routes.js` now imports
  every route chunk, and each whole-App test imports it at its top, so the
  compile happens while the file loads, where nothing is timed. (Six files
  already did this for Settings alone.) `warm-routes.test.js` fails when a
  route chunk is added or removed and the list is not updated.
- **Unmocked requests waited 1.5 s for real.** The test fetch mocks threw
  on a route they did not know. A thrown fetch is a transport failure, and
  `packages/client`'s query client retries one after a real 1.5 s
  (`retryDelay`). Some tests waited through that retry. The retry could
  also land after cleanup, in the next test's mock. The mocks in
  `first-answer` and `app` now answer an unmocked route with a 404 that
  names it. A 404 is never retried.
- **`account-journeys` never closed its handler's pool.** Its scratch
  database's `drop ... with (force)` killed the pool's four idle
  connections, which is where the `db_pool_error` lines came from. The pool
  was not the cause of the slowness: that was the Settings chunk compiling
  inside the 5 s wait for "Player tag". `afterAll` now closes the handler
  before it drops the database.

Unloaded, the slowest test in each file went from 1763 to 126 ms
(first-answer), 1538 to 89 ms (app), 197 to 107 ms (player-page) and
8927 to 410 ms (account-journeys). The pull request has the loaded runs.

## The deploy left `fixtures/card-roles.snapshot.json` modified

The vocabulary step stamped the snapshot with `source_commit` = the HEAD of
`../cr-agent-api-docs`. That moves with any commit there, so nearly every
deploy rewrote the file. Now:

- `source_commit` is the last commit that touched the two data files the
  vocabulary is read from (`data/card-roles.json`,
  `data/deck-aliases.json`). `roles_version` is that commit's time, as
  before. The snapshot is a pure function of the vocabulary. It was
  refreshed once in this change.
- The deploy only checks the snapshot (`snapshotIsCurrent`). When it is
  behind, the deploy warns and names
  `import-card-roles.mjs --snapshot-only`. The deploy never writes it.
- A guard: after its build, the deploy reads `git status --porcelain
  --untracked-files=no`. If any tracked file has changed, it stops before
  anything is uploaded and names the files. A `clean-tree` phase just
  before the record checks the tree again after the site, vocabulary and
  acceptance phases. What shipped is live by then, so the record is still
  written and the deploy exits 1 with the file names.

## The headroom floors are unchanged, and each run now records its cost

The review asked whether the floors in `infra/scripts/lib/db-headroom.mjs`
(50% for the whole suite, 25% for a family) fit the gate on a
db.t4g.micro. The deploy logs cannot answer that:

- Five deploys on 2026-11-13 ran the gate with 0 failures. They ran 129 to
  134 cases and 111 to 114 door calls, about 1 to 2 minutes of calls.
- Each logged the byte and I/O balances at 99 to 100% before the run.
- None logged a balance during or after its run.
- All of them ran on the temporary db.t4g.small, not the micro.

The 10 to 15 point cost in `docs/OPERATIONS.md` was read off the balance
graph by hand, while the gate still included 666 Gym cases. So the floors
stay as they are.

What was missing is now recorded:

- After every acceptance run, pass or fail, the deploy reads the lowest
  one-minute `EBSByteBalance%` and `EBSIOBalance%` from the run's start to
  its end (`readHeadroomLow`).
- It prints `acceptance cost:` with:
  - the balances before the run and the lowest during it
  - the drop
  - the run's minutes
  - the instance class from the template
- The deploy record keeps the same values as `acceptance_headroom`.

A few of these records from runs on the micro will be enough to set the
floors. CloudWatch lags a minute or two, so the record also keeps the time
it was read.
