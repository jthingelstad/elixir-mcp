# Elixir MCP

Clash Royale history, recorded, and served to your own agent.

The Clash Royale API only answers "what is true right now": no trophy
timelines, no battle archive beyond a rotating log of about 30 battles, no
per-season history. Elixir MCP records those observations continuously and
keeps them. It records the players and clans its accounts track and the
members of the clans it tracks. The record is served on one origin: the
Console, Ladder and Elixir Clan in the browser, an authenticated remote MCP
server for agents, and a versioned JSON API.

- Web: <https://elixir.poapkings.com>
- MCP: `https://elixir.poapkings.com/mcp`
- JSON API: `https://elixir.poapkings.com/api/v1`

**What the service does is documented publicly**, at
<https://elixir.poapkings.com/docs>; this repository does not describe product
behavior. Want to help run the fetch fleet? See
[the operator guide](https://elixir.poapkings.com/docs/operators).

## Repository

An npm workspaces monorepo.

| Path | What it holds |
| --- | --- |
| `apps/site` | The static half of the site (Eleventy): home, docs, updates, and the machine-readable surfaces |
| `apps/web` | The application half (React): the Console, Ladder (`src/ladder`) and the shell Elixir Clan's views run in |
| `services/` | The Lambdas, each only its door (entry, handler, routes): `collector`, `email-relay`, `jobs`, `mcp`, `migrate`, `scheduler`, `timeline-sync`, `web-api` |
| `packages/` | What more than one Lambda or app runs, imported by name: `auth`, `claims`, `client`, `clan`, `clan-engine`, `clan-state`, `clan-web` (Elixir Clan), `collector-door` (the collectors' config, lease and submit), `contracts` (the tool and API contract), `design`, `docs`, `ingest`, `ledger`, `mail`, `outbox`, `record`, `syndication` (the timeline cross-posted to Discord), `tools` (the tool registry), `ui` |
| `acceptance/` | The read-only acceptance suite run against the live service |
| `db/migrations` | The ordered schema migrations |
| `infra/` | The CloudFormation template and the build, deploy and maintenance scripts |
| `AGENT-TEAM/` | The objective owners that maintain the service |
| `docs/` | Engineering invariants, the decision ledger and the working notes |

For contributors: [AGENTS.md](AGENTS.md) holds the golden rules and points to
each area's own guide (Console, Ladder, Clan, tools, site, infra);
[docs/ENGINEERING.md](docs/ENGINEERING.md) the build invariants and
[docs/DECISIONS.md](docs/DECISIONS.md) the ratified decisions.
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
