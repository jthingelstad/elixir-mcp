# apps/web: the signed-in app and the shared shell

The React application behind every path a session or a live read draws:
Home (`/home`), the pages still under `/console`, Ladder (`/ladder`, guide in `src/ladder/`), Elixir
Clan (`/clan`, views from `packages/clan-web`) and the public battle page
(`/battle/<id>`). The root `AGENTS.md` golden rules apply; product
behaviour is in `apps/site/src/docs/`, not here.

## How it is built

- **React 19, TanStack Router and TanStack Query.** The route tree is in
  `src/App.jsx`, with one lazy chunk per section under `src/pages/`.
  `src/lib/queries.js` is the one place for query keys and hooks; the
  reader's own things are keyed under `["me", ...]`, so invalidating the
  session refetches all of them (Clan's keys start `["me", "clan"]`,
  Ladder's `["me", "ladder"]`).
- **Paths carry their prefix.** Every Console path is written with
  `CONSOLE` (`src/lib/console.js`) and every Ladder path with `LADDER`, not
  a router basepath, because the kit's `Link` renders `to` verbatim.
- **One build serves three surfaces.** CloudFront routes `/home`, `/signin`,
  `/data/service`, `/console`, `/ladder`, `/clan` and their descendants to the web/API Web Function for
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
  so the bridge counts each view after it once.
- No Radix before a real dialog; no PWA. `test/inline-styles.test.js` is a
  ratchet on inline styles: the count only goes down.

## Testing

- `npm test -w @elixir-mcp/web` (vitest, jsdom) for logic and views.
- `npm run e2e` runs Playwright (`e2e/`) against the built app with `/api`
  route fixtures and axe. There is no local API runner: the dev server's
  `/api` proxy (port 4319) has nothing behind it. A signed-in check against
  the real door waits for the deploy.

## Home and the shell

`src/home/` is Home (`/home`, `/home/timeline`, `/home/friends`), and
`src/shell/Shell.jsx` is the top bar, bottom tabs and footer every page wears.
`src/lib/moved.js` is the one map of old paths to new ones, read by the root
route; every path that moves goes there. Home's rules are in
`docs/product/home.md`; its reads are `services/web-api/src/routes/home.mjs`.

## The Console's sections

The word Console is retired from what a reader sees; `/console/` still holds
Explore, Status's collectors and Admin. `src/views/` holds the pages,
`src/views/account/` the Settings and agent pages; the route table is in
`App.jsx`. `src/lib/settings.js` is Settings' rail and paths, and
`src/lib/moved.js` redirects every old account address (mail in inboxes names
them; an entry leaves only when no archived mail can). Sections: Explore
(players, clans, decks, weeks, record pages), Settings (`/settings`: profile,
players, emails, connections and agents, sign-ins, usage, feedback, collectors),
an agent's own page (`/settings/agents/<public_id>`, five tabs), the service
page (`/data/service`, with collectors and efficiency under
`/console/status/`), and Admin. Admin pages are gated on the server; the client
only hides them.
