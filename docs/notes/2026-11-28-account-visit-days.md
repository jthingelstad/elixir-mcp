# 2026-11-28 — A signed-in visit to the website is marked, one row a day

Earlier today the website's own reads left `mcp_call_audit`
(`2026-11-28-web-reads-not-logged.md`). The ops funnel had read those rows
as evidence of a return, so a person who came back only to the website, on
a session made earlier, stopped counting. Jamie, on being told: "that
funnel data is good to have… we should make sure that we know when
authenticated visitors do return".

## What changed

- **`account_visit_day` (0321):** `(account_id, day)`, the primary key,
  nothing else. One row a person a UTC day on which they used the website
  signed in. No path, tool, count, address, device or time of day. It is
  a visit mark, not a call log.
- **The write** (`services/web-api/src/visit-day.mjs`, called from
  `resolveAccount` in `handler.mjs` with `visit: true`): only
  `GET /api/me`, the app's session read, asks for it, and only when a
  cookie session resolved. `insert ... on conflict do nothing`.
- **The funnel** (`services/migrate/src/ops-funnel.mjs`): visit days join
  the `own` activity, so `came_back_7d`/`_30d` count a website return and
  `signed_in` counts a visit (only a session can write one). The op's
  shape is unchanged; its comment and notes say what counts.
- **Kept a year** (the retention ladder, `account_visit_day.day`) and
  **deleted with the account** (`account-remove.mjs`; the tombstone fires
  no cascade, so it is a named step). `limits.md` lists it.

## Why `GET /api/me`

It is the read the app makes when one of its pages opens, when a tab the
person comes back to is a minute stale (the query client's refetch on
focus), and after the person changes their session (a sign-in, a claim, a
time zone). Nothing the app does on its own calls it: the feed's
"new" poll (visible tabs only), the bell, the own-battles refresh and the
Recruit and refresh timers read other routes, and the service worker has
no fetch handler and posts only `/api/me/push/opened` after a tap. Share
pages, RSS feed links and the one-click unsubscribe take no session, and
mail and Discord links reach this read only by opening the app. So a mark
means the person had Elixir in front of them.

The 2026-10-08 rule in the funnel, "A session only seen or refreshed is not
a return", is kept: the session row's `last_seen_at`, which every request
slides (polls included), is still never read. The visit day is not a
session touch; it is written by the one read a person's looking causes.

Never marked: the MCP door (its calls are in the funnel through the call
log), `GET /api/v1/me`, a bearer token on any route (a tool or a script),
anonymous requests, the collector door, jobs and the timeline-sync lane.
`services/web-api/test/visit-day.test.mjs` pins these, and that nothing
but `visit-day.mjs` writes the table.

## Cost

A warm web-api instance remembers which accounts it marked today (up to
10,000, cleared at the UTC day's turn), so the insert runs at most once a
person a day an instance, on that `GET /api/me`. Every other request,
and every later `GET /api/me` that day on that instance, costs nothing.
A failed insert is one warn line (`visit_mark_failed`, the error's name
and code, no account id); the request answers as usual, and the pair is
not remembered, so the next read tries again. Routes run outside a
transaction, so a failed insert aborts nothing else.

## Gap

A return to the website alone between the deploy of
`2026-11-28-web-reads-not-logged.md` and 0321's is not counted; nothing
recovers it.

Ships with migration 0321; no JSON API or MCP change, and nothing a person
sees changes, so no What's new entry.
