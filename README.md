# Elixir MCP

Elixir is the missing social layer of Clash Royale: follow your friends and
your clan, see how they play, and cheer them on.

Members follow players and clans and read a feed of their sessions, firsts
and highlights on the web, with one digest email. Underneath is a record
the official Clash Royale API does not keep: it answers only "what is true
right now", with no trophy timelines, no battle archive beyond a rotating
log of about 30 battles and no per-season history. Elixir's collectors
record the players and clans its accounts follow and the members of the
clans they follow, and keep those observations. The record is served on one
origin: Home, Stats and Clan in the browser, an authenticated remote
MCP server for a person's own agent, and Sign in with Elixir for the
family's apps.

- Web: <https://elixir.poapkings.com>
- MCP: `https://elixir.poapkings.com/mcp`
- Sign in with Elixir: `GET https://elixir.poapkings.com/api/v1/me`

**What the service does is documented publicly**, at
<https://elixir.poapkings.com/docs>; this repository does not describe product
behavior. Want to help run the fetch fleet? See
[the operator guide](https://elixir.poapkings.com/docs/operators).

## Repository

An npm workspaces monorepo.

| Path | What it holds |
| --- | --- |
| `apps/site` | The static half of the site (Eleventy): home, docs, updates, and the machine-readable surfaces |
| `apps/web` | The application half (React): Home (`src/home`: the feed, Find, You and the player page), Settings and Admin, Stats (`src/ladder`) and Clan (`src/clan`) |
| `services/` | The Lambdas, each only its door (entry, handler, routes): `collector`, `email-relay`, `jobs`, `mcp`, `migrate`, `scheduler`, `timeline-sync`, `web-api` |
| `packages/` | What more than one Lambda or app runs, imported by name: `auth`, `claims`, `client`, `clan`, `clan-engine`, `clan-state`, `collector-door` (the collectors' config, lease and submit), `contracts` (the tool and API contract), `design`, `docs`, `ingest`, `ledger`, `mail`, `outbox`, `record`, `syndication` (the timeline cross-posted to Discord), `tools` (the tool registry), `ui` |
| `acceptance/` | The read-only acceptance suite run against the live service |
| `db/migrations` | The ordered schema migrations |
| `infra/` | The CloudFormation template and the build, deploy and maintenance scripts |
| `scripts/` | The setup hook for a session's own worktree |
| `docs/` | Engineering invariants, the decision ledger, how production is operated, and one note per change |

For contributors: [AGENTS.md](AGENTS.md) holds the golden rules and points to
each area's own guide (the web app, Stats, Clan, tools, site, infra);
[docs/ENGINEERING.md](docs/ENGINEERING.md) the build invariants,
[docs/DECISIONS.md](docs/DECISIONS.md) the ratified decisions and
[docs/OPERATIONS.md](docs/OPERATIONS.md) how production is operated.
`node infra/scripts/build-site.mjs` builds both halves of the site into one
tree and validates it; `npm run verify` is the pre-push gate.

The collector that operators run lives in its own repository,
[elixir-mcp-collector](https://github.com/jthingelstad/elixir-mcp-collector);
the collector contract stays canonical here in `packages/contracts`.

Secrets are never committed (verify with `git ls-files`). Clash Royale API keys
exist only in collector operators' local `.env` files.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
