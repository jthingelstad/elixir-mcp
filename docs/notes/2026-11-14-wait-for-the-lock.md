# 2026-11-14 — Tests wait for the lock, never a fixed sleep

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes. Tests and a test helper only.

An assessment found tests that slept a fixed time and assumed a
concurrent handler had reached a row lock, or that a debounce had
passed. On a loaded host the sleep ends first and the test takes a path
it never meant to: a flaky test, which this repository treats as a
defect.

## The helper

`waitUntilBlocked(db, target, { count, timeoutMs })` in
`packages/ingest/test/helpers.mjs`, beside `scratchDb`. It polls
`pg_locks` for an ungranted lock held by one of: the backends queued
behind a holder (`blockedBy`, through `pg_blocking_pids`), named `pids`,
a waiter for an advisory key (`advisoryKey`, the `hashtext` text), or an
`applicationName`. `pg_locks` is live inside a transaction, so the holder
itself can watch; `pg_stat_activity` is a snapshot held for the reader's
whole transaction.

## What changed

- **Fixed sleeps replaced by the helper:** the one-click unsubscribe
  racing a removal (`web-api.test.mjs`), the donation reset window
  (`reset-window.test.mjs`), the add that waits on another account's
  change (`claims.test.mjs`, whose "not settled" is now asserted once
  the add is seen queued), and the role change behind a promotion
  (`auth.test.mjs`).
- **Hand-rolled polls moved onto the helper:** `cutover-race.test.mjs`
  (it gave up after 100 ms), `clan-lock.test.mjs`, `clan-session.test.mjs`
  (5 s), the rate-limit overlap in `auth.test.mjs`, and
  `clan-oauth-retirement.test.mjs`, which read `pg_stat_activity` from
  inside the retirement's open transaction and so could never see a
  waiter that queued after its first read.
- **UI:** the search sheet's two-letter rule runs on vitest's fake clock
  and now also shows the same clock carries a third letter through;
  the 13-or-older refusal runs the fake clock past Turnstile's bound
  (a real 20 ms could never have seen a send); the magic-link test
  drains every started read until none starts; Invite clanmates waits
  for the clans read to settle before asserting it drew nothing. The
  cards journey holds its script until the page shows the art failed.
- **Kept, on purpose** (`query-budget.test.mjs`): the 200 ms tool that
  must outlast a 50 ms deadline is the thing under test, and the 300 ms
  first read orders against the deadline's own timer, which Node fires
  in expiry order however late. The 50 ms pause before reading the
  settings back is gone: one client runs its queries in order.
