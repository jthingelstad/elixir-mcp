# Elixir MCP

Clash Royale history, recorded, and served to your own agent.

The Clash Royale API only answers "what is true right now": no trophy
timelines, no battle archive beyond a rotating log of about 30 battles, no
per-season history. Elixir MCP records those observations continuously and
keeps them. It records the players and clans its accounts track, the members
of clans recorded at comprehensive scope, the players on the ranked
leaderboards, and the members of collections. The record is served through an
authenticated remote MCP server and a versioned JSON API.

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
| `apps/web` | The application half (React): sign-in, explore, account, admin, live data |
| `services/` | The Lambdas and their shared core: `auth`, `editor`, `email-relay`, `ingest`, `jobs`, `mcp`, `migrate`, `scheduler`, `web-api` |
| `packages/` | Shared workspace packages: `claims`, `client`, `contracts` (the tool and API contract), `design`, `docs`, `mail`, `ui` |
| `acceptance/` | The read-only acceptance suite run against the live service |
| `clients/boards` | A client that keeps the leaderboard collections equal to the boards |
| `db/migrations` | The ordered schema migrations |
| `infra/` | The CloudFormation template and the build, deploy and maintenance scripts |
| `AGENT-TEAM/` | The objective owners that maintain the service |
| `docs/` | Engineering invariants, the decision ledger, working notes and reviews |

For contributors: [AGENTS.md](AGENTS.md) holds the golden rules,
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
