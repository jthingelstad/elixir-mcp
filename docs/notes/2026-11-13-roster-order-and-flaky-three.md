# 2026-11-13 — Three test failures under load: causes and fixes

Three failures seen under heavy host load on 2026-11-13, each traced to
its cause rather than rerun past.

- **Sign-in mail limit (#972).** No production defect. The per-viewer
  and per-address ceilings are one `INSERT ... ON CONFLICT DO UPDATE ...
  RETURNING count` each, so overlapping asks queue on the bucket's row
  and each takes its own count. The test fired 12 asks at once through
  the test pool's two connections; the queued ones waited past the
  2.5 s connect bound, answered 503 before either counter ran, and the
  test read a 503 as "not limited". The door test now asks one at a
  time and requires every answer to be a 200. The overlap is pinned in
  `packages/auth`, forced with a held row lock rather than timed; a
  check-then-write counter fails it.
- **`clans_roster` order (#970).** Members of one role on equal trophies
  had no order between them, so two identical reads could disagree. The
  roster now breaks ties by the game's clan rank, then player tag (MCP
  13.1.1). The 297 s query-budget duration in the same report was the
  file's `before` (createScratch waiting for one of the run's scratch database slots), which node:test
  charges to a file's first test; the cancel itself is checked by
  SQLSTATE, not time.
- **Account journeys (#963).** Each page fires up to nine reads at once
  at the test pool's two connections. On a loaded host the pool's 2.5 s
  connect bound answered the tail of that queue 503; the client retried
  once and then showed an error that no wait could find, and every step
  raced a clock (findBy, a 20 s test, a 60 s setup). Slowing every query
  by 120 ms reproduced it (a 503 and a 21 s journey). The journeys' pool
  now has no connect bound (`makeDatabase`'s `connectionTimeoutMillis`,
  the doors' 2.5 s everywhere else), every wait is for its condition,
  and any 5xx or failed section ends the test at once, naming it. The
  timeouts left are hang guards; the file passes with every query
  slowed by 150 ms. Waiting for the condition also exposed a race in
  the claim step: `findByText("#00J")` matched one element only between
  the list's refresh and the move to the new player's page, where the
  tag appears two or three times; it now waits for that page and its
  heading.
- **Vacuum guard test (#979).** Under load one page of 885 stayed
  unmarked after `{vacuum}`: a plain VACUUM that cannot take a page's
  cleanup lock leaves its bit unset. The tests assert what the op
  promises, the check's own threshold, not every page.
