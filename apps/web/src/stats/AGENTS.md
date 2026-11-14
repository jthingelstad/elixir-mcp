# Stats

`/home/you/stats` (`STATS` in `paths.js`, which imports nothing; `stats.js` re-exports it): a player's season, read back,
the last tab of You. It was Ladder, at `/ladder`, until 2026-11-12, and the
code took the name Stats on 2026-11-14; "ladder" in code now means only the
Trophy Road game mode (and the stored values listed below). The old `/ladder`
addresses stopped forwarding on 2026-11-13. A section of the Elixir app
in the shared shell, under You's tabs (`YouTabs` in `src/home/You.jsx`), with a scope bar instead of a rail (`ScopeBar.jsx`:
Player, Season, mode chips, freshness) and four tabs: Season, Battles, Decks,
Cards. The route is in `src/App.jsx`, the page chunk
`src/pages/StatsPage.jsx`, which owns the scope read and each tab's href; the
views and their shaping functions (`stats*.js`) live here. Public docs:
`apps/site/src/docs/ladder.md`.

- **Stats has no API of its own.** Every read is an MCP tool answered
  through Stats' door, `POST /api/me/stats` (`api.stats`, hooks in
  `src/lib/queries.js` under `["me", "stats", ...]`): the app's tool
  bridge behind a per-tag gate that opens only for the reader's own
  players and the players they follow, and refuses the rest with 403
  `not_followed` (Jamie, 2026-11-12; `services/web-api/src/routes/tool-bridge.mjs`).
  A followed player opens from their player page's **Their stats**
  (`?player=`); the page then wears no You tabs, and its words come from
  `whose.js` ("their" for "your"). A person's own
  reads spend no daily tool-call quota (#538, Jamie 2026-10-12) but share
  the hourly bucket (`mcp#<account>`, 300) with their own MCP clients, so
  pages cache for minutes and never poll. Two exceptions (2026-10-08),
  both account state and not tool reads: before a
  player's first capture lands, `Pending.jsx` shows "Your first capture
  is on its way" and polls the capture status
  (`/api/me/first-answer`, every 5 s for the first 3 minutes after the
  add, then every 60 s: `nextPoll` in `hooks/useFirstAnswer.js`), then
  refreshes the Stats reads once when it lands. "Lands" is both reads:
  the profile AND a battle-log read (`capturePending` / `captureLanded`
  in `stats.js`); the profile alone arrives seconds after an add and
  sets `recorded_since`, which is not a capture. A tag the game answered
  404 never lands, and Pending says "Tag not found". Bring your
  clanmates is not on Stats: it moved to Find's Your clan (2026-11-12).
  A number Stats needs that no tool returns is a tool change
  (`.claude/skills/tool-change/`), never a client derivation.
- **Facts, never verdicts.** Everything on a page is something a tool
  returned. No pace, rating, coaching line or verdict word ("Elixir
  rates no player", "Form is numbers only" in `docs/DECISIONS.md`); a
  direction stated with its numbers ("up from 52% to 58%") is a fact.
  The shaping functions route and shape, they never rate.
- **Modes are different games.** Every read passes one `mode`, and nothing
  on a page pools across modes (`MODES` in `stats.js`). Two exceptions, neither
  a rate: the scope read has no mode, to learn which chips to draw, and the
  season sweep behind the calendar has none, to count other modes on a day
  apart. Other (`OTHER_GROUPS`) reads Challenge and Tournament apart.
- Tests: `apps/web/test/stats*.test.js` (shaping) and
  `apps/web/e2e/stats.spec.ts` with `stats-fixture.ts`.
- **Still named `ladder`, on purpose** (stored or public, never renamed
  with the code): the docs slugs (`/docs/ladder`, `ladder-season`,
  `ladder-battles`, `ladder-decks`, `ladder-cards`, which `elixir_docs`
  serves), the feedback area value `ladder` (stored on each item; it reads
  as Stats), the mail source label "Ladder" (`MAIL_SOURCE` in
  `packages/mail`), and the docs group key in `apps/site`. The mode value
  `ladder` is Trophy Road, a game mode, and is not this surface.
  `apps/web/test/stats-name.test.js` keeps the surface name from coming
  back.
