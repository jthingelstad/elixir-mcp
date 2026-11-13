# apps/web: the signed-in app and the shared shell

The React application behind every path a session or a live read draws:
Home (`/home`), Settings (`/settings`, Admin under it for staff), Stats (Ladder, `/home/you/stats`, guide in `src/ladder/`),
Clan (`/clan`, guide in `src/clan/`) and the public battle page
(`/battle/<id>`). The root `AGENTS.md` golden rules apply; product
behaviour is in `apps/site/src/docs/`, not here.

## How it is built

- **React 19, TanStack Router and TanStack Query.** The route tree is in
  `src/App.jsx`, with one lazy chunk per section under `src/pages/`.
  `src/lib/queries.js` is the one place for query keys and hooks; the
  reader's own things are keyed under `["me", ...]`, so invalidating the
  session refetches all of them (Clan's keys start `["me", "clan"]`,
  Ladder's `["me", "ladder"]`).
- **Paths carry their prefix.** Every Stats path is written with `LADDER`,
  not a router basepath, because the kit's `Link` renders `to` verbatim.
- **One build serves three surfaces.** CloudFront routes `/home`, `/signin`,
  `/settings`, `/clan` and their descendants to the web/API Web Function for
  session-aware server rendering; every other path is a site document
  (`apps/site`). Site tests evaluate the static router and pin the
  explicit native app behaviors. `node infra/scripts/build-site.mjs` builds both halves
  and validates the merged tree.
- **The kit is shared, never copied.** `packages/design` (tokens and
  component CSS, compiled once by Tailwind v4 into `dist/styles.css`),
  `packages/ui` (chrome, rail, log table, freshness, Markdown, icons,
  error boundary, disclaimer, the clock vocabulary, the family manifest
  `src/family.json`) and `packages/client` (the `{ ok, status, data }`
  envelope, `createClient()`, the query client and its one retry rule).
  What a view needs that the kit lacks is a kit addition.
- **New pages use the kit's parts:** `PageHead`, `Tabs`, `Chips`, `Panel` and
  `Rows`, `Table`, `Empty` and `ErrorState`, `Stats`, `FreshChip`, all in
  `@elixir-mcp/ui`. Never a hand-written `<table>`: at phone width no table
  scrolls sideways. See `docs/notes/2026-11-05-the-kit.md`.
- **Time:** a member page says when through `useClock` (`when`, `whenDay`,
  `calendar`, `clock`), the one format, in the account's zone (Admin keeps
  `stamp`); day-bucketed charts stay UTC and say
  so. Render stays pure: read the clock once per visit
  (`useState(() => new Date())`), never `new Date()` in render.
- **Analytics:** `src/analytics.js` is the Tinylytics bridge. Counts per
  page, never per account; a record page reports as its kind; `/signin`
  loads no analytics. The embed (`/js/script.js`, site in `data-site`) counts
  the document; its own History counting is switched off with `data-spa="false"`
  so the bridge counts each view after it once. A document that starts on
  `/signin` or a record page loads no embed; its loader listens for the same
  `data-tinylytics-event` clicks and beacons each event at the route (nothing
  on `/signin`), so `trackEvent` works in every session (#508).
- No Radix before a real dialog. Elixir installs as a web app
  (`public/manifest.webmanifest`, its icons, the head tags here and in
  the site's `base.njk`, pinned by a site test); no service worker. `test/inline-styles.test.js` is a
  ratchet on inline styles: the count only goes down.

## Testing

- `npm test -w @elixir-mcp/web` (vitest, jsdom) for logic and views.
- `npm run e2e` runs Playwright (`e2e/`) against the built app with `/api`
  route fixtures and axe. There is no local API runner: the dev server's
  `/api` proxy (port 4319) has nothing behind it. A signed-in check against
  the real door waits for the deploy.

## Home and the shell

`src/home/` is Home (`/home`, one feed), Find (`/home/find`), You
(`/home/you`, your primary verified player's page with the Stats tab) and the
player page (`/home/player/<tag>`), and
`src/shell/Shell.jsx` is the top bar, bottom tabs and footer every page wears,
with the bell (`src/shell/Bell.jsx`, its logic `bell-logic.js`, its read
`services/web-api/src/bell.mjs`).
`src/lib/moved.js`, read by the root route, forwards only the addresses
Elixir still sends that are not a page themselves (a clan's bare address and
its Actions list, to the Feed). Old addresses stopped forwarding on
2026-11-13 (Jamie: "It is fine to break url support"); a page that moves
changes its producers instead. Home's rules are in
`docs/product/home.md`; its reads are `services/web-api/src/routes/home.mjs`,
and the feed's extra fields are `services/web-api/src/feed.mjs`.

## The Console folded

The Console folded (2026-11-12): no page lives under `/console/`, and since
2026-11-13 its old addresses are the site's 404 (CloudFront no longer
routes them to the app). Find's
search and a player page's Record tab still read through `POST
/api/explore`, the tool bridge. `src/views/` holds the pages,
`src/views/account/` the Settings and agent pages; the route table is in
`App.jsx`. `src/lib/settings.js` is Settings' rail and paths. Settings (`/settings`:
profile, players, emails, connections and agents, sign-ins, usage, feedback,
collectors), an agent's own page (`/settings/agents/<public_id>`, five tabs),
and Admin (`/settings/admin/<page>`, its own route, rail and lazy chunk, with
Service, Fleet and Efficiency; Settings offers it to staff only). Admin pages
are gated on the server; the client only hides them. The service's public
half is the site's `/data`.
