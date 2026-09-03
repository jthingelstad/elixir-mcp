# Elixir MCP

Clash Royale history, recorded — and served to your own agent over MCP.

The Clash Royale API only returns current state: no trophy timelines, no battle
archive beyond a ~30-battle rotating log, no per-season history. Elixir MCP
records history for opted-in players and clans and exposes it through an
authenticated remote MCP server you connect to Claude or any MCP client.

- Web: `elixir.poapkings.com` (request access, claim your tag, dashboard)
- MCP: `https://elixir.poapkings.com/mcp`

**Status: live and recording.** Start with
[docs/DESIGN.md](docs/DESIGN.md); working notes in
[docs/NOTES.md](docs/NOTES.md). Want to help run the fetch fleet? See
[docs/OPERATORS.md](docs/OPERATORS.md).

## Repo shape

npm workspaces monorepo: `apps/web` (site), `services/` (web-api, mcp,
scheduler, ingest, email-relay, gateway), `packages/` (contracts, game-data),
`db/migrations`, `infra/`.

Secrets are never committed — see `.gitignore` and DESIGN.md §7. CR API keys
exist only in gateway operators' local `.env` files.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
