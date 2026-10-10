# clan-web

Elixir Clan's views. Read `packages/clan/AGENTS.md` first, and
`apps/web/AGENTS.md` for the shell they join.

- **No app of its own.** `createClanRoutes()` (`src/routes.jsx`) adds Clan's
  routes to the one `apps/web` router and lazy-loads the shell and views;
  it creates no router, query provider or build. Paths use `CLAN`
  (`src/lib/base.js`).
- **Data:** `src/api.js` calls `/api/clan` with the shared session, CSRF
  header and the kit's client; drafting calls get a longer timeout. Query
  keys start `["me", "clan"]` (`src/lib/queries.js`), so the session
  refresh invalidates them.
- **The kit is shared:** components come from `@elixir-mcp/ui` and styles
  from `@elixir-mcp/design`; a gap is a kit addition. `test/inline-styles.test.js`
  ratchets inline styles down.
- **Analytics** (`src/analytics.js`, Elixir's Tinylytics site): pages report
  as `/clan/...` with the tag masked; events are bounded labels, never free
  text, a tag or a URL. The events, which this list must match:
  `clan.action_commented`, `clan.action_link_copied`, `clan.award_granted`,
  `clan.awards_saved`, `clan.away_cleared`, `clan.away_set`,
  `clan.copy_in_game`, `clan.discord_nudge`, `clan.discord_removed`,
  `clan.discord_set`, `clan.feedback_answered`, `clan.feedback_sent`,
  `clan.hold_set`, `clan.model_drafted`, `clan.model_key_removed`,
  `clan.model_key_set`, `clan.note_added`, `clan.place_cleared`,
  `clan.place_set`, `clan.policy_preset`, `clan.policy_previewed`,
  `clan.policy_saved`, `clan.recruit_copied`, `clan.recruit_saved`,
  `clan.scout`, `clan.social_set`, and the client's `web.*` failures.
- Tests: `npm test -w @elixir-mcp/clan-web` (vitest, jsdom) and
  `apps/web/e2e/clan/`.
