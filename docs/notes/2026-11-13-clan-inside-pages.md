# 2026-11-13 — Clan's pages move into the app

Jamie, 2026-11-12: "Clan is just a set of features INSIDE of Elixir. If
there is any remnant of Clan being separate and an 'integration' that
should be changed." Step 5 of that, first half: Clan's views stop being
a package of their own. This round is the move; the next one takes out
the bridge and the duplicated helpers the move leaves visible.

**Moved, unchanged.**

- `packages/clan-web/src` is `apps/web/src/clan`, and its tests
  `apps/web/test/clan`. Git sees every file as a rename.
- Its guide is `apps/web/src/clan/AGENTS.md`.
- The app imports the views by path (`./clan/routes.jsx` and the
  rest), not as `@elixir-mcp/clan-web`. `leaflet`, which only the clan
  map uses, is now `apps/web`'s dependency.
- The package's own `package.json`, `tsconfig.json` and vite config
  went. Its tests run under the app's vitest config, in the `web` unit
  (`infra/scripts/test.mjs` folds its weight into `web`), and the
  `e2e/clan/` journeys are unchanged.

**What the app's rules found.**

The app's source-wide tests now read Clan's files too.

- `inline-styles.test.js`: the two ratchets are one, set at the count
  the merged sources have today (235; the two ceilings were 158 and 107).
- `links.test.js`: Clan has 34 anchors that take their own click where
  the app uses the kit's `Link`. The app's rule stays at zero for the
  rest of `src`; Clan's count is pinned at 34 and only goes down.
- `writes.test.jsx`: the map's "Remove me" awaits its write and drops
  the answer. It is named as the one known case.
- knip: with the package's `./*` export gone, eleven exports only their
  own file used are no longer exported, and Clan's copy of the
  Tinylytics loader and route bridge (`loadTinylytics`,
  `bridgeRouteChanges`), which nothing called since the app's loader
  took over, went. `analyticsLocation`, `trackEvent` and `routeLabel`
  stay.
- The shared test paths follow the move: `one-time-format`,
  `bare-timers`, `no-clan-specifics`, `e2e-needed.sh` and the
  `ci-tooling` test. Tailwind's `@source` for the package went; the
  app's `src` already covers the files.
- `no-real-tags` passes: no moved file holds a real-looking tag.

No page, address, wording, server route, MCP contract or JSON API
changes. No What's new entry: nobody notices.
