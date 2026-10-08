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
  One exception (2026-10-08): before a player's first capture lands,
  `Pending.jsx` shows "Your first capture is on its way" and polls the
  Console's capture status (`/api/me/first-answer`, unmetered account
  state, every 60 s), then refreshes the Ladder reads once when it lands.
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
