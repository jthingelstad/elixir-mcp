# Ladder

`/ladder`: a player's season, read back. A section of the Elixir app
beside the Console, in the same shell, with its own rail (`LadderRail.jsx`)
and pages: Season, Days played, Decks, Cards. The route is in
`src/App.jsx`, the page chunk `src/pages/LadderPage.jsx`; the views and
their shaping functions (`ladder*.js`) live here. Public docs:
`apps/site/src/docs/ladder.md`.

- **Ladder has no API of its own.** Every read is an MCP tool answered
  through the Explore bridge (`api.explore`, hooks in
  `src/lib/queries.js` under `["me", "ladder", ...]`), so it is priced
  against the reader's own quota. Pages cache for minutes and never poll.
  Two exceptions (2026-10-08), both unmetered account state: before a
  player's first capture lands, `Pending.jsx` shows "Your first capture
  is on its way" and polls the Console's capture status
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
  returned. No pace, rating, coaching line or derived player metric
  (`docs/DECISIONS.md`); the shaping functions route and shape, they
  never rate.
- **Modes are different games.** Every read passes one `mode`, and nothing
  on a page pools across modes (`MODES` in `ladder.js`).
- Tests: `apps/web/test/ladder*.test.js` (shaping) and
  `apps/web/e2e/ladder.spec.ts` with `ladder-fixture.ts`.
