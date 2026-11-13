# 2026-11-13 — A query abandoned at the deadline could still run unbounded

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes.

`services/mcp/test/query-budget.test.mjs` ("cancelled in PostgreSQL, not
abandoned") failed once under a loaded local Postgres: the call took
the whole ten seconds of its `pg_sleep`. The test was right; the race was
in `timedDb` (`packages/tools/src/invoker.mjs`).

A budgeted query is sent in two steps: set the connection's
`statement_timeout` to the time left, then send the query. When the
deadline fired while that `set_config` was in flight, the invoker
answered and queued the restore (`statement_timeout` back to 0). When
the `set_config` came back, the abandoned tool sent its query anyway.
It sat behind the restore, so it ran with no timeout, and every later
statement on that connection (the audit insert first) waited for it. In
production that is a heavy read running on after its Lambda has
answered, which is what the per-query timeout exists to stop.

`timedDb` now checks the budget again after the `set_config`, with no
await before the send. A deadline that has passed, or a budget the
restore has closed, throws `query_timeout` instead of sending.

The new test holds the `set_config` reply until the call has answered,
so it fails on the old code every time and needs no clock. The stress
harness (six copies of the file at once, eight rounds, against eight
busy Postgres connections) passed 48 of 48 both before and after the
fix: the window is narrow, and the held reply is what reproduces it.
