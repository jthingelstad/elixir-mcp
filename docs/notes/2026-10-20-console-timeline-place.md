# 2026-10-20 — The Console's Timeline keeps its own place

Jamie, 2026-10-20: "timeline should be independent of what agents have
seen via MCP." The rail's Timeline dot counted subjects with news since
`account.activity_seen_at`, the account's unnamed read pointer, which
only an MCP `elixir_timeline` `mark_read` moves. A person with no agent
saw a dot that never cleared, and every row said "Unread by
connections". No contract change: MCP 11.13.1 and JSON API 3.2.0.
Migration 0228. The deploy runs no acceptance family: no tool's
declaration or output changed.

- **0228** adds `account.console_timeline_seen_at`, nullable with no
  default (catalog-only). It is not a `timeline_reader` row: a named
  reader would count in `meta.timeline_pending`, which follows the
  oldest live named pointer, and so would change what agents see.
- **`GET /api/me`** `signals.timeline_pending` counts subjects whose
  `poll_state.last_admitted_at` is after the Console's place (all of
  them while it is null), the same query as before against the new
  column.
- **`GET /api/me/timeline`** returns `seen_to` (the Console's place) and
  no longer `read_to`. Its window and items are unchanged.
- **`POST /api/me/timeline/seen`** `{ to }` moves the place to
  `greatest(place, least(to, now()))`: forward only, never past now. A
  `to` that is missing, not a time or in the future is `400
  invalid_to`; the contract header is required. It is agent-scoped, so
  on an agent's console the owner's visit moves the agent's place.
- **Console ▸ Timeline** posts the window end it showed once per window,
  then refetches the console's `me` so the dot follows. It reads the
  place once, when the page opens, and marks each item with
  `observed_at` after it **New**, with a "New since your last visit"
  rule under the last of them (the kit's `LogTable` gained a `divider`
  prop for event lists). The State filter offers new and earlier.
  "Unread by connections" and the footnote about connections' place are
  gone.
- **Account removal** (`{account_remove}`) nulls the new column with
  the read pointer.

Every reader of `activity_seen_at` was checked. MCP's `meta` and
`elixir_timeline` default window, the owner's list of agents
(`principals.mjs`: each agent's news since its own read pointer, by
design) and account removal keep it. No mail or digest reads it, so no
mail changes.

Independence is pinned in `services/web-api/test/timeline-seen.test.mjs`:
an agent's `mark_read` leaves the Console's dot and place alone, and a
Console visit leaves `activity_seen_at`, a named reader and
`meta.timeline_pending` alone.

Defaults taken [engineering]:

- The column is `console_timeline_seen_at` on `account`, beside
  `activity_seen_at`, rather than a table of its own.
- The place moves by an explicit POST of the window end the page
  showed, not on the GET, so a read for evidence or a prefetch never
  moves it, and an item learned after the read is still new next time.
- `read_to` left `/api/me/timeline`; nothing else in the Console read
  it.
- The signal keeps its name, `timeline_pending`, and the rail's dot its
  title, "Unread notifications".
- Connections' read state is dropped from the page rather than shown
  once: each agent's row on Connections already counts its own news
  since its pointer, and a person's own client has no page.
- New is by `observed_at` (what the record learned), as the read pointer
  is. The rule goes under the last new row in display order, so nothing
  new sits below it; an earlier row the feed's order puts above it has
  no New mark.
- A first visit (no place yet) marks nothing new and draws no rule.
- A failed write is not retried until the page shows a later window.
- The privacy page is unchanged: the place is ordinary account data,
  removed with the account.
- The public description is on the connections page (Where things are
  in the console), not the timeline page: `timeline.md` is at its
  `elixir_docs` size budget (`docs-size.test.mjs`).
