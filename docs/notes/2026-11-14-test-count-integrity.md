# 2026-11-14 — A test file that reports short fails its unit

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes. The test runner, the workspaces' test scripts and CI's
test job only (#1052).

**What happened.** In one loaded local `npm run verify` on unchanged
`main`, the `root` unit reported 259 tests, 0 failed, where it always
reports 267. The 8 missing were the last 8 that
`acceptance/bites.test.mjs` defines, and the file still counted as
passed. While this change was being made, a baseline run of the old
runner did it again in another unit: `clan` reported 306 of its 339
tests, green.

**The cause.** Every unit ran `node --test --test-force-exit`. `node
--test` runs each file in a child process that streams its results to
the parent over a pipe on stdout. With `--test-force-exit` the child
calls `process.exit()` as soon as its tests end (node's
`internal/test_runner/test`: it waits for the reporter to unpipe, not
for stdout to drain). On macOS a pipe is written asynchronously, so
when the parent is slow to read, results still queued in the child are
dropped at exit. The child exits 0, and the parent counts what it read:
a short report that passes. Linux writes pipes synchronously, which is
why CI never showed it.

Proved locally on Node 24.22.2, by stopping the parent with SIGSTOP for
2 to 3 s while a file finishes:

- one file of 3,000 tests: 4 of 10 runs short (2,975 to 2,997 tests)
  with the flag, 0 of 10 without; under plain CPU load (30 busy loops
  on 10 cores), 1 of 12 short with the flag, 0 of 12 without;
- the real `root` unit: one of six runs reported 223 of 267 and exited
  0 with the flag; six of six reported 267 without.

**What changed.**

- **No `--test-force-exit`.** It came in on 2026-11-13
  (`2026-11-13-test-db-slots.md`) so a file whose connect failed before
  a `try` would not hang holding its slot. Without it, nothing hangs:
  every unit ends on its own, and two runs of the database units
  against a private PostgreSQL capped at 14 connections, failing
  everywhere with "too many clients", ended too. CI's test shards now
  stop at 15 minutes (`timeout-minutes`; a shard takes about 2), so a
  file that ever leaks a handle fails its shard instead of holding it
  for six hours.
- **Every file must report every test it ran.** Each `node --test` unit
  runs `infra/scripts/lib/every-file-reported.mjs` beside `spec`. The
  last thing a file's process writes is its own summary (a
  `test:summary` event carrying the file and the number of tests it
  ran). The reporter fails the unit, naming the file, when a file's
  summary never arrived or when the results read from it number fewer
  than it says. It prints one line either way
  (`every-file-reported: 13 files, each reported all of its tests
  (267)`), and `test.mjs` fails a node unit that exits 0 without that
  line, so a unit that lost the reporter cannot pass. Nothing is counted
  by hand: each file states its own number, so adding a test needs no
  edit anywhere.
- **Why this mechanism.** Node has no listing or dry-run mode, and a
  dry pass that imported every file would double the slow part of the
  run (the imports and scratch databases), while tests made inside
  loops and other tests are only known by running them. The summary is
  produced by the same process that ran the tests, after the last of
  them, so it is the one count a lost tail cannot keep. Cost: none
  measurable; the reporter keeps three event types and compares two
  numbers per file (the runner took 99 s and 93 s, against 96 s for
  the old runner, on the same machine).
- **Scripts name their test files.** A bare `node --test` also ran 11
  helper modules under `test/` (seeds, fixtures, budgets) as if they
  were test files: each reported one empty "test" and no summary, which
  the check cannot tell from a file whose report was lost entirely. The
  25 such scripts are now `node --test '**/*.test.mjs'`; the totals
  drop by those 11 phantom tests and nothing else.
- **vitest units** (`web`, `ui`) are not counted this way: vitest reads
  results over its own worker channel and fails a test whose worker
  exits mid-file (tried: `process.exit(0)` in a test reads
  "process.exit unexpectedly called", 1 failed).
- `services/mcp/test/ci-tooling.test.mjs` pins it: a fixture unit whose
  file exits 0 after 2 of its 5 tests fails (node alone says 2 tests,
  0 failed, exit 0, and the old runner passed it), the complete file
  passes with its count, a unit without the line fails, and no
  workspace script is a bare `node --test` or uses force-exit.

**Clean runs with this change:** 3,197 node tests in 381 files across
29 units, plus vitest's 957 (`web`) and 137 (`ui`), the same in every
run: two idle, and two side by side (a full `npm run verify` and a
second tree's runner) beside 10 busy threads on 10 cores, where the
runner took 504 s and 538 s instead of 99 s.

**If it comes back:** the unit's output names the file and both
numbers. A file with no summary and no failure exited early: look for a
`process.exit` in the file or what it imports.
