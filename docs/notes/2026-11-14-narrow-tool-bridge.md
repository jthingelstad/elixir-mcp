# 2026-11-14 — The app's tool bridge answers only the app's own tools

The browser's tool bridge (`services/web-api/src/routes/tool-bridge.mjs`,
formerly `explore.mjs`) still opened every read-only tool to a signed-in
browser, as the Console's Explore page needed until it folded on
2026-11-12. The app now calls it for five tools only, so the route answers
those five and refuses the rest:

- `players_summary`, `players_profile`: a player page's Record tab
  (`apps/web/src/lib/queries.js`, `usePlayerRecord`).
- `players_summary`, `clans_roster`, `players_search`: Find and the search
  sheet (`apps/web/src/shell/search-logic.js`, `SearchSheet.jsx`).
- `elixir_nickname`: the nickname editor (`api.setNickname`), the
  bridge's one write.

Any other tool answers the route's existing refusal, 400 `bad_request`,
before it runs and before it spends the hourly bucket. Stats keeps its own
list and door (`STATS_TOOLS`, `POST /api/me/stats`); Seen's latest battle
already read through it. Sign-in, the hourly bucket, the unmetered daily
quota and each tool's own reading rules are unchanged, so nobody can see
or do anything different through the five tools.

The route moved to `POST /api/me/tool` (the client's `api.tool`), and
`CONSOLE_WRITES` is `APP_WRITES`. `POST /api/explore` answers with the
same narrowed handler for browser tabs loaded before the deploy; a later
pull request removes it (pinned by
`services/web-api/test/tool-bridge.test.mjs`). Nothing in CloudFront or
the template named the path (`/api/*` reaches web-api), and no public doc
described it. No MCP or JSON API contract change; nothing a player sees
changes, so no What's new entry.
