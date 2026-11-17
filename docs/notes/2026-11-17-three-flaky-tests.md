# 2026-11-17: Three flaky tests fixed at their cause

Three tests failed under load and passed alone. Each is fixed where the
race was, with no retry of an assertion and no longer timeout. Tests
only: no product code, contract or migration changes.

## Web units: "window is not defined" after every test passed

PR #1092's first CI run failed `test (1/3)` with 1017 of 1017 passing:
an unhandled `ReferenceError: window is not defined` from React's
scheduler (`performWorkUntilDeadline`, the passive-effect flush, which
reads `window.event` first), attributed to `account-page.test.jsx`.

Cause: vitest runs with `globals: false`, so Testing Library's automatic
afterEach cleanup is never registered. Files that clean up only in
`beforeEach` (account-page among them) leave their last test's whole
App mounted, its queries still answering and React's scheduler still
working through what they queued, one setImmediate slice at a time.
vitest tore jsdom down between two slices.

Fix: `apps/web/test/setup-react-settle.js`, a setup file every test
file now loads, runs `settleReact()` (`test/react-settle.js`) after each
test: unmount, then wait for an idle-priority scheduler task, which runs
after every task queued ahead of it. `test/react-settle.test.jsx` pins
both halves: unmounting alone leaves a queued task to run later (the
crash), and settleReact runs it while `window` exists. `scheduler` is
now a declared dev dependency of `apps/web` (it was already installed
through react-dom).

## Jobs: the fail-fast timing cases

`services/jobs/test/jobs-db.test.mjs` gave its runs 300 ms real limits
and asserted "ended in under 2 s". Under load the healthy connect to the
scratch database itself took longer than 300 ms, so the silent and reset
cases failed with "no connection" instead of the cause under test, and
the deadline case's deadline fired before its client existed (a
TypeError). The timeout cases now mock `setTimeout` (pg's connect and
read timers and the run's deadline all use it): each waits for the run
to reach the state under test, checks the run is still waiting 1 ms
short of the limit, moves the clock to it, and asserts the error and its
cause (`timeout expired`, `Query read timeout`). The reset case needs no
clock: a 60 s statement can only end early by the reset. A 30 s test
timeout stops a regression from hanging the suite.

## web-api budget seeds and the migrate vacuum test: the visibility map

The budget tests (`signed-in-budget`, `people-budget`,
`clan-landing-budget`) hold real things: statement counts, plan shapes
and shared-buffer ceilings. Those are only a measure of the code when
the seed's visibility map is whole. VACUUM marks a page all-visible only
when its rows are older than every snapshot another backend in the
database holds, and on the shared local server one often is (autovacuum
analyzing the freshly cloned scratch database, its snapshot held old by
other runs' transactions). Holding one snapshot across the seed's bare
`vacuum analyze` reproduces it every time: 8 of 19 signed-in budget
tests fail, with whole-table scans of `battle` and `/manage` at 98,593
buffers against 30,000.

Fix: the seeds call `vacuumWhole` (`packages/ingest/test/helpers.mjs`):
wait until no other backend in the database holds a snapshot, vacuum,
and confirm every table's map is whole (within 1 percent or two pages, a
plain VACUUM's cleanup-lock skips). A snapshot taken between the wait
and the vacuum can cost a pass; the pass runs again, at most five times,
and the error names what stayed short. This repeats setup until its
precondition holds, never an assertion. `vacuum-whole.test.mjs` pins it
with a snapshot the test holds itself.

`services/migrate/test/vacuum.test.mjs` asserts that `{vacuum}` makes the
map whole, which is the same horizon. A 15 s wait for a quiet moment
still raced it. Its probe rows are now written frozen (`COPY ... FREEZE`
into the table made in the same transaction; VACUUM FULL keeps them
frozen), which no snapshot can hide from VACUUM, and the test holds an
old snapshot open through the op to prove the result no longer depends
on who else is connected. The ladder's test now asserts what the ladder
does (its VACUUM (ANALYZE) ran on the declared table after the commit:
no statistics before, pages and rows after) and leaves the map to the
`{vacuum}` test.
