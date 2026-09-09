# Elixir MCP

Clash Royale history, recorded — and served to your own agent over MCP.

The Clash Royale API only returns current state: no trophy timelines, no battle
archive beyond a ~30-battle rotating log, no per-season history. Elixir MCP
records history for opted-in players and clans and exposes it through an
authenticated remote MCP server you connect to Claude or any MCP client.

- Web: `elixir.poapkings.com` (request access, claim your tag, dashboard)
- MCP: `https://elixir.poapkings.com/mcp`

**Status: live and recording.** Start with
[the public documentation](https://elixir.poapkings.com/docs) for the product and
[docs/ENGINEERING.md](docs/ENGINEERING.md) for the build invariants; working notes in
[docs/NOTES.md](docs/NOTES.md). Want to help run the fetch fleet? See
[the operator guide](https://elixir.poapkings.com/docs/operators).

## Repo shape

npm workspaces monorepo: `apps/site` (the static site: home, docs, updates,
changelog, `llms.txt`/`tools.json`), `apps/web` (the application: sign in,
explore, account, admin, live charts), `services/` (web-api, mcp, auth,
scheduler, ingest, migrate, email-relay), `packages/` (contracts, design,
game-data), `db/migrations`, `infra/`. `node infra/scripts/build-site.mjs`
builds both halves into one tree and validates it. The collector operators run lives in its own repo:
[elixir-mcp-collector](https://github.com/jthingelstad/elixir-mcp-collector)
(the queue contract stays canonical here in `packages/contracts`).

Secrets are never committed — see the golden rules in [AGENTS.md](AGENTS.md); verify with `git ls-files`. CR API keys
exist only in collector operators' local `.env` files.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
