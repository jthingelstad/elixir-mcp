# 2026-11-28 — The website's own reads leave the call log

Jamie, 2026-11-28: "The intent is to log and quota MCP calls because that
is a product component of Elixir. But API calls that are part of the user
USING Elixir are just part of site usage, and should not be logged in the
database (I think we would operationally log them for debugging and cloud
operations!) but it isn't a quota and is NOT part of the product."
Approved: "stop logging website and /api/v1/me reads to mcp_call_audit,
and give website reads their own rate limit". This replaces the
2026-10-12 direction ("Usage accounting still records them") in
`docs/DECISIONS.md`.

## What changed

- **No call-log row for the site's reads.** The tool bridge
  (`POST /api/me/tool`, Stats' `POST /api/me/stats`) and Home's panel
  reads (`/api/me/home/week`, `/api/me/home/clan`) run through
  `makeRecordReader`, Clan's unaudited in-process reader, by way of
  `services/web-api/src/web-reads.mjs` (`makeWebReader`). Same registry,
  tools and deadline; no `mcp_call_audit` row, no capture, no request id
  and no pending hints. `makeRecordReader` takes an optional `onRead`
  callback for the log line; Clan passes none and is unchanged.
- **An operational line instead**, one per tool read on stdout:
  `{ at: "web_read", door: "tool" | "stats" | "home", tool, ms, db_ms,
  db_queries, live_wait_ms?, code?, request_id }`, a warn for `internal`,
  `timeout` and `query_timeout`. Never a tag, a name, an account id or
  the arguments. `request_id` is the handler's, so the line joins the
  request line. Home keeps its `home_panel` lines: the panel line says
  which panel was slow, `web_read` which tool inside it.
- **`GET /api/v1/me`** writes no row. The handler's request line was
  already one per call (operation, status, ms); the route now adds
  `v1_request_id` (the id the caller was answered with) and the problem's
  `code` through `trace`. Its `rest-person-hour:` metering is unchanged.
- **The website's own hourly bucket**, `web#<account>`, 300 an hour
  (`WEB_HOURLY_RATE_LIMIT` in `web-reads.mjs`). Every web-api route that
  charged `mcp#` moved: the bridge, Home's first paint, the player page
  and the account search. Home's panel and the people reads' multipliers
  are now of the web constant (same numbers). `mcp#` is the MCP door's
  alone. Account removal already deletes `web#<id>` (its rate-limit step
  matches any bucket ending in the account id).
- **Usage and Requests are MCP calls only.** `GET /api/me/usage` drops
  `web_calls`, `web_calls_today` and the Website caller;
  `GET /api/me/requests`, the call record and Admin's usage counts filter
  out surfaces `web` and `rest` (`services/web-api/src/call-log.mjs`).
  Rows written before this change age out with the log's 28 days (the
  last on 2026-12-26); the filter can go after 2026-12-27. No row is
  deleted and there is no migration.

## What it means for other readers

- **Feedback** (`packages/feedback`): a call reference must be a
  request id in the filer's call log. No web page quotes a bridged
  read's request id (no page read `meta.request_id` or the pending hints
  from a bridged answer), so nothing the website files is affected.
- **The ops funnel** (`services/migrate/src/ops-funnel.mjs`):
  `came_back_7d`/`_30d` count a call in the log as a return. Website use
  through a session made earlier no longer leaves a row, so from today a
  person who comes back only to the website, on an old session, is not
  counted as returning. Signing in, a new session and MCP calls still
  count. The query is unchanged; its comment says so.
- **ops-analysis and ops-captures** group by surface, so leftover `web`
  rows show as their own line until they age out.

Ships with no migration and no JSON API version change.
