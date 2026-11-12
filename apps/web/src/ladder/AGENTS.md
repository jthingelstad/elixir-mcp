# Ladder (Stats)

`/home/you/stats` (`LADDER` in `paths.js`, which imports nothing; `ladder.js` re-exports it): a player's season, read back,
called Stats to a reader since 2026-11-12, the last tab of You. The code keeps
the name Ladder. Every old `/ladder` address redirects to the same page under
it (`ladderMoved` in `paths.js`, read by `src/lib/moved.js`). A section of the Elixir app
in the shared shell, under You's tabs (`YouTabs` in `src/home/You.jsx`), with a scope bar instead of a rail (`ScopeBar.jsx`:
Player, Season, mode chips, freshness) and four tabs: Season, Battles, Decks,
Cards. The route is in `src/App.jsx`, the page chunk
`src/pages/LadderPage.jsx`, which owns the scope read and each tab's href; the
views and their shaping functions (`ladder*.js`) live here. Paths that moved
are in `src/lib/moved.js`. Public docs:
`apps/site/src/docs/ladder.md`.

- **Ladder has no API of its own.** Every read is an MCP tool answered
  through Stats' door, `POST /api/me/stats` (`api.stats`, hooks in
  `src/lib/queries.js` under `["me", "ladder", ...]`): the Explore
  bridge behind a per-tag gate that opens only for the reader's own
  players and the players they follow, and refuses the rest with 403
  `not_followed` (Jamie, 2026-11-12; `services/web-api/src/routes/explore.mjs`).
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
  refreshes the Ladder reads once when it lands. "Lands" is both reads:
  the profile AND a battle-log read (`capturePending` / `captureLanded`
  in `ladder.js`); the profile alone arrives seconds after an add and
  sets `recorded_since`, which is not a capture. A tag the game answered
  404 never lands, and Pending says "Tag not found"; and Bring your clanmates, below the season home,
  reads the account's home clan from `/api/me/clans` (cached, never
  polled) to name the clan it invites to.
  A number Ladder needs that no tool returns is a tool change
  (`.claude/skills/tool-change/`), never a client derivation.
- **Facts, never verdicts.** Everything on a page is something a tool
  returned. No pace, rating, coaching line or verdict word ("Elixir
  rates no player", "Form is numbers only" in `docs/DECISIONS.md`); a
  direction stated with its numbers ("up from 52% to 58%") is a fact.
  The shaping functions route and shape, they never rate.
- **Modes are different games.** Every read passes one `mode`, and nothing
  on a page pools across modes (`MODES` in `ladder.js`). Two exceptions, neither
  a rate: the scope read has no mode, to learn which chips to draw, and the
  season sweep behind the calendar has none, to count other modes on a day
  apart. Other (`OTHER_GROUPS`) reads Challenge and Tournament apart.
- Tests: `apps/web/test/ladder*.test.js` (shaping) and
  `apps/web/e2e/ladder.spec.ts` with `ladder-fixture.ts`.
