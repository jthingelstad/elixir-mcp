# 2026-11-11 — Everyone signs in: the gate, measured and pinned (#759)

MCP and JSON API unchanged; no migration; no route opened or closed. Slice 1
of the social layer (#752, plan `2026-11-11-social-build-plan.md`), from
DECISIONS "Everyone signs in; shared posts stay public" [Jamie,
2026-11-11].

## What the measurement found

The 2026-10-12 audit (#526, `2026-10-12-w1-public.md`) had already closed
every read of a subject's record to accounts except a battle's page. A
signed-out read of the record today is a battle link, and nothing else.

Neither log says whether a request carried a session: the web API's
request line has the route key, status and time, and the CloudFront access
log has the path, status, user agent and cache result. The proxies used
are the public routes' counts (every one of them could be signed out) and
the gated routes' refusals (each one a signed-out or expired caller,
already turned away). The web API's line covers 2026-10-13 to 2026-11-11
(its 30 days); the access log starts 2026-10-28.

Public routes, web API request line, 30 days (status 200 unless named):

| Route | Requests |
|---|---|
| `GET /api/public/status` | 1,118 (5 at 503) |
| `GET /api/public/cards` | 205 |
| `GET /api/public/stats` | 138 |
| `GET /battle/*` | 75 (4 at 404) |
| `GET /api/public/battles/*` | 30 |
| `GET /api/public/efficiency` | 14 |

At the edge, 2026-10-28 to 2026-11-11, split by a user-agent heuristic
(bots, crawlers, link unfurlers and scripts against browsers):

| Path | Browser | Bot or script |
|---|---|---|
| `/battle/*` | 22 | 16 |
| `/api/public/battles/*` | 6 | 6 |
| `/api/public/status` | 753 | 131 |
| `/api/public/stats` | 12 | 67 |
| `/api/public/cards*` | 35 | 274 |
| `/api/public/efficiency` | 14 | 2 |

Refusals of gated routes, web API request line, 30 days: `/api/clan/*` 228
at 401, `/api/v1/*` 173 at 401, `/api/admin/*` 95 at 403, `/api/me/timeline`
1 at 401. The app pages (`/home`, `/console`, `/ladder`, `/settings`,
`/clan`) answer 200 to everyone because the server renders the shell; a
signed-out visit gets the sign-in wall in it, not the record.

## What changed

- `services/web-api/test/public-boundary.test.mjs` cites the new decision,
  classes every public route from a closed set (record, status, reference,
  plumbing), pins the record class to exactly the battle link's two routes,
  leaves a marked place for slice 4's shared post (#762), and pins that a
  signed-out `GET /api/me` carries only `authenticated` and `features`.
- `apps/web/test/ssr.test.jsx` renders every record page signed out (Home's
  three tabs, Settings, the service page, Explore and its record pages,
  every Status and Admin page) and requires the sign-in wall; Ladder keeps
  its invitation.
- The wall's words say the record opens to members, and that verifying
  an email signs in or creates an account.
- `apps/site/src/docs/privacy.md` says what opens without an account.

## Checked, unchanged

- **MCP** refuses any request with no bearer (`services/mcp/src/handler.mjs`),
  `tools/list` included; OAuth's own routes are plumbing.
- **`/api/v1`**: every operation in the OpenAPI document refuses a missing
  credential with 401 (`integration-routing.test.mjs`).
- **The collector door**: every route needs a collector token.
- **poapkings.com**: its roster import calls `/api/v1` with its `clans:read`
  key and reads `/api/public/cards` with no key, so the card list stays
  open.
- **Drop**: the clock and Sign in with Elixir call `/api/v1` with a bearer
  (`services/api/src/elixir-mcp.ts`, `elixir-oauth.ts`).
- **elixir-mcp-discord**: MCP at its agent URL with its own token.
- **Clan**: every `/api/clan/*` answer resolves a person first, except its
  health and the retired callback (`CLAN_UNSIGNED`).
- **The site**: its build bakes `/data` from `/api/public/stats` and `/cards`
  from `/api/public/cards`; in the browser it reads only
  `/api/public/status` (`data-live.js`, `home-status.js`) and posts
  feedback, which needs a session.
- **Mail**: a mail link to a record page meets the wall, then returns
  there after sign-in; accepted by the decision.

## Defaults taken

- The battle page's JSON stays open with the page, which reads it. [issue
  default]
- `/data` and its reads (`/api/public/status`, `/api/public/stats`,
  `/api/public/efficiency`) stay open: they count the recorder, not the
  record. [issue default]
- The card catalog stays open as reference; closing it would break the
  site build and poapkings.com's roster import. [engineering, 2026-11-11]
