# 2026-11-13 — Clan's pages use the app's shell, states and helpers

Step 5 of "Clan is just a set of features INSIDE of Elixir" (Jamie,
2026-11-12), second half. The first half moved `packages/clan-web` into
`apps/web/src/clan`; this one takes out the bridge between them and the
helpers Clan kept for itself.

**The bridge goes.**

- `lib/host.js` (the context the app used to lend Clan its follow
  buttons) is gone. `ClanHead` and Members import Home's
  `FollowThisClan`, `FollowClan` and `FollowMember` directly.
- `ClanShell`, a shell of its own with a frame, a landing and a
  remembered sign-in passed in as options, is `ClanLayout`: a plain
  route layout under the app's shell. `createClanRoutes(parent)` takes
  no options.
- The app's `ClanOutlet` (`src/App.jsx`) draws the bar, rail and footer
  for Clan as it does for Home. Signed out it shows the app's
  `SignInWall`; with the session read unanswered, the app's
  `Unavailable` page, now its own module (`src/shell/Unavailable.jsx`)
  and also what `ClanLayout` shows when the clan read goes unanswered.
  A clan read that answers 401 makes the app read its session again,
  so its sign-in page follows.

**Signed out and the verify notice** (Jamie's approval: "Approved: ship
the signed-out /clan page and verify notice using Elixir's existing
signed-out wording").

- Clan's own landing page (`views/Landing.jsx`) is gone; `/clan...`
  signed out is Elixir's "Sign in first" page, which remembers the
  address for after sign-in. `/clan` signed in is the chooser, as
  before.
- Clan's notice after sign-in (`views/VerifyNotice.jsx`) is gone. You's
  "Verify your player" panel is a shared component
  (`src/components/VerifyPlayer.jsx`); `/clan/verify` shows it with a
  Continue button that records the acknowledgement as before.
- The `clan.signin_started` event went with the landing.

**Duplicated helpers go.**

- `lib/links.js` (`ELIXIR_LINKS`, `inApp`): the app's `HOME`,
  `SETTINGS` and `VERIFY` paths instead. Every link it held was already
  in the app, so Refused's plain-anchor branch went too.
- `playerPath` in `lib/base.js`: the app's `playerHref`.
- Clan's copy of `trackEvent`: the app's (`src/analytics.js`), which was
  the same function. `analytics.js` keeps `analyticsLocation` and
  `routeLabel`, which only Clan has.
- The `inline-styles` ratchet is 227, the count today.

**Unchanged.** Every address (`/clan/<tag>` and `/clan/<tag>/actions`
still forward to the Feed), the gate and every visibility rule (the
gate's refusals, `RUN_READS`, `runsTheClan`, `eldersUp`, role
freshness, the same client conditions), the server, MCP and the JSON
API. "Elixir Clan" as a product name went from the comments of the
files touched here.

**Left.** Clan's 34 anchors that take their own click, the map's
"Remove me" that drops its answer, and Clan's own `useNav` (it keeps a
Clan address in the app, where the app's sends a person without the
`clan_internal` flag through a page load) are still Clan's own.
