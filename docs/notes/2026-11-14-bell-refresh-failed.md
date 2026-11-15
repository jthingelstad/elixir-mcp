# 2026-11-14 — A failed bell refresh says so (#1029 follow-up)

No MCP tool, `/api/v1` operation, contract version, migration, route or
stored data changes. The web app's bell only.

Codex on #1029: the badge's earlier read of `GET /api/me/bell` is cached
under `["me", "bell"]`, and the open sheet reads it again
(`refetchOnMount: "always"`). When that fresh read failed, TanStack Query
kept the cached data, so the sheet's `failed` (only when there is no data)
hid the error: the old rows, or "All quiet", with no sign of the failure
and no way to retry.

## What changed

- A failed fresh read over cached rows keeps the rows and puts one line at
  the top of the sheet, "Couldn’t refresh just now, so this may be out of
  date.", with **Try again** (`role="status"`, `.kit-bell__stale`). The full
  ErrorState stays for a failed read with nothing cached.
- "All quiet" never shows from a failed read.
- The seen marker does not move after a failed read: the rows shown were
  not refreshed, so anything newer was never seen. It moves once a retry
  succeeds.

Pinned in `apps/web/test/bell.test.jsx` (rows kept, no PUT, Try again then
one PUT; an empty cached read is not "All quiet") and in
`apps/web/e2e/bell.spec.ts` at 320, 390 and 1280 with axe.
