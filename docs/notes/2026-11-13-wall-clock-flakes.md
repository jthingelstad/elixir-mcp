# 2026-11-13 — Two tests that read the wall clock failed on a loaded host

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes.

A local `npm run verify` on a host running several suites at once failed
two tests that pass alone. Both read wall-clock time the host did not
give them.

- **Home › Friends drew 6 decks of 10** (`services/web-api/test/home.test.mjs`,
  "past the ten-card cap"). The route stops drawing decks 5 s before the
  request's soft deadline. With no soft deadline (no HTTP context: tests,
  a local server) it invented one 20 s out, so a slow host trimmed decks
  by design. `deadline.mjs` says a request with no HTTP context has no
  deadline unless the caller supplies one; the route now agrees
  (`routes/home.mjs`). In Lambda the handler always sets
  `softDeadlineAt`, so production is unchanged, and the past-deadline
  test still pins the trim.
- **A fresh profile poll read as 5 s old or more**
  (`services/mcp/test/answer-integrity.test.mjs`). The test wrote the
  poll, ran another tool, then required the poll be under 5 s old. It now
  requires no older than the test's own run since the write, which still
  sets it apart from the battle log's two days.
