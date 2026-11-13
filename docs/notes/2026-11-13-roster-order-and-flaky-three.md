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
- **Account journeys (#963).** See the pull request that closes it.
