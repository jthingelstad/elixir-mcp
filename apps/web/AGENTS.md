# apps/web: the Console and the shared web shell

The React application behind every path a session or a live read draws:
the Console (`/console`), Ladder (`/ladder`, guide in `src/ladder/`), Elixir
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
- **One build serves three surfaces.** CloudFront routes `/console`,
  `/ladder`, `/clan` and their descendants to `/app.html`; every other path
  is a site document (`apps/site`). A site test evaluates the function and
  pins the split. `node infra/scripts/build-site.mjs` builds both halves
  and validates the merged tree.
- **The kit is shared, never copied.** `packages/design` (tokens and
  component CSS, compiled once by Tailwind v4 into `dist/styles.css`),
  `packages/ui` (chrome, rail, log table, freshness, Markdown, icons,
  error boundary, disclaimer, the clock vocabulary, the family manifest
  `src/family.json`) and `packages/client` (the `{ ok, status, data }`
  envelope, `createClient()`, the query client and its one retry rule).
  What a view needs that the kit lacks is a kit addition.
- **Time:** stamps go through the kit's `stamp`/`useClock`, in the
  account's zone and named by zone; day-bucketed charts stay UTC and say
  so. Render stays pure: read the clock once per visit
  (`useState(() => new Date())`), never `new Date()` in render.
- **Analytics:** `src/analytics.js` is the Tinylytics bridge. Counts per
  page, never per account; a record page reports as its kind; `/console/signin`
  loads no analytics.
- No Radix before a real dialog; no PWA. `test/inline-styles.test.js` is a
  ratchet on inline styles: the count only goes down.

## Testing

- `npm test -w @elixir-mcp/web` (vitest, jsdom) for logic and views.
- `npm run e2e` runs Playwright (`e2e/`) against the built app with `/api`
  route fixtures and axe. There is no local API runner: the dev server's
  `/api` proxy (port 4319) has nothing behind it. A signed-in check against
  the real door waits for the deploy.

## The Console's sections

`src/views/` holds the pages, `src/views/account/` the Account and agent
pages; the rail and route table are in `App.jsx`. Sections: Dashboard,
Explore (players, clans, decks, weeks, record pages), Account (profile,
emails, tracking, timeline, usage, connections, agents, devices, verify,
feedback), an agent's own console (`/console/agent/<public_id>/…`), Status
(collectors, efficiency), Data, and Admin. Admin pages are gated on the
server; the client only hides them.
