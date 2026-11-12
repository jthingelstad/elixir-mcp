# 2026-11-12 — Stats opens for the players you follow

Jamie, 2026-11-12: "Stats opens for the players you follow", from their
player page, with the same record reads You uses. Only your own players
and the players you follow; anyone else is refused server-side.

## What changed

- **A door of its own, `POST /api/me/stats`** (`services/web-api/src/routes/explore.mjs`).
  Stats' reads (`players_summary`, `battles_performance`, `battles_decks`,
  `battles_cards`, `battles_opponents`, `battles_query`, `elixir_coverage`,
  `war_current`, `war_history`) are the same MCP tools answered through the
  same bridge as `POST /api/explore`, with the same audit and hourly
  bucket. Before the bridge, the route normalizes `player_tag` and looks
  for one claim of this account on that one tag whose relationship is
  primary, alt or friend (`statsOpens`, a per-tag `=` read, never
  `any($1)`). No such claim: 403 `not_followed`. A watched player is not
  followed. `segment` and `on_behalf_of` are refused (they would read past
  the one player); `war_current` takes a `clan_tag` only.
  `services/web-api/test/web-api.test.mjs` pins own and followed opening,
  watched and stranger refused, unfollow closing it, and the 400s.
- **The client** reads Stats (and Seen's own-player `battles_query`)
  through `api.stats`; Find's search and a player page's Record tab keep
  `api.explore`.
- **Stats for a followed player.** `ladderPlayers(claims, param)` adds the
  followed player `?player=` names; the picker lists them under
  **Following**. The page wears a link back to their player page in place
  of You's tabs, hides the young-record panel (it is about verifying your
  own), and takes its words from `ladder/whose.js` ("their" for "your").
  The player page's door reads **Their stats** for a followed player.
- e2e: `mockApi` answers `POST /api/me/stats` with the fixture's
  `POST /api/explore` answer unless a test names Stats itself.

## Not changed, and why

- `POST /api/explore` still serves any tag: universal reads (2026-09-05)
  and VISION ("everything from the game: every member") keep Find and the
  player page's Record open. The gate is Stats' door, not the record's.
- No MCP tool or contract change.

## Decision

DECISIONS "Stats opens for the players you follow" [Jamie, 2026-11-12]
already stands and replaces `docs/product/ladder.md`'s "show a friend's
season" (lines 5 and 62), which still read as before; the brief's banner
is for whoever next edits it.
