# 2026-11-13 — Clan's routes are the web API's own

Jamie, 2026-11-12: "Clan is just a set of features INSIDE of Elixir. If
there is any remnant of Clan being separate and an 'integration' that
should be changed." Step 4 of that: Clan stops being a door inside the
web API.

**Before.** The web API sent every `/api/clan/*` path past its route
table to Clan's handler. Clan then had its own:

- route key (`GET /api/clan/*`);
- catch-all 500 (`{"error":"internal"}`);
- stringified log line.

**Now.**

- `services/web-api/src/routes/clan.mjs` registers Clan's routes in the route table:
  - the health check (`CLAN_UNSIGNED`), which takes no database lease;
  - `me`, `select`, `verify-notice`, `roster`, `directory` and `me/place`;
  - one family for a clan's own pages, `/api/clan/clans/**`;
  - a family for any other `/api/clan/` path, so a signed-out caller still learns nothing from which paths exist.
- Every route but health signs the person in first, as before.
- The router learned families (`METHOD /prefix/**`, the nearest prefix wins).
- The addresses are unchanged, and so is every answer body the views read.
- **One line per request.**
  - Clan's handler returns its story as `trace`.
  - The web API's line folds it in. That covers the route Clan answered (`GET /api/clan/clans/*/week`, never a tag), plus `elixir_ms`, `elixir_calls`, `store_ms`, `store_ops`, the lock wait (`lock_ms`), the clan and role, and any model calls.
  - A slow or failing Clan request is a warn line.
  - Clan writes no line of its own.
  - A Clan read inside Home keeps a line of its own (`in_process: true`) with the request's id, as it had.
- **Errors.**
  - A thrown error is the web API's to handle. The line says 500, and the caller gets the shared `{"error":"unavailable"}` 503.
  - Before, that case was Clan's own `{"error":"internal"}` 500.
  - Clan's pages and the shared client treat any 5xx alike (unavailable, one quiet retry), so no view changes.
  - Every answer Clan gives on purpose (401, 403, 404, 409, 410, a service's error code) is unchanged.
- **The lock is unchanged (#868).** Views run outside it, writes run inside it, and the stale-read refusal still applies (`clanLockPlan`, `PURE_VIEWS`, `NARROWED`).
- **Latency report.** `npm run web-latency`'s Clan split reads the folded line, and still reads the old stringified ones in a window from before. No metric filter or alarm read Clan's line.

No MCP contract or JSON API change.
