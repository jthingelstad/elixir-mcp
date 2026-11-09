# 2026-11-09 — web-latency: timeouts join by request id, window edges count once

Two corrections to `npm run web-latency` (#728), from its review:

- **Timeouts reach their route.** The web-api handler logs a timeout
  under its own route key, which for whole families is coarse
  (`GET /api/clan/*`, `GET /api/v1/*`), so a Clan or JSON API timeout
  never attached to the reported route. The web and timeout queries now
  carry `message.request_id`, and a timeout counts against the outer
  line with the same id; the handler's key is only a fallback.
- **An event on a window edge counts once.** StartQuery's start and end
  are both inclusive, so the day windows and their halves could return a
  boundary event twice. Rows are now kept once by request id (the whole
  log line for the Clan trace), and a row with no identity is never
  dropped.

The 2026-11-09 baseline does not move: a rerun 34 minutes later gave the
same web table, and the MCP tool counts differ by at most two calls, the
window's own drift. No timeout in that week was on a Clan or JSON API
route. No contract, JSON API, migration or Lambda change.
