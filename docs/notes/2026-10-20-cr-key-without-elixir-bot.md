# 2026-10-20 — `npm run cr` no longer looks in elixir-bot

Jamie removed the retired elixir-bot checkout, so its `.env` leaves the
key sources of `infra/scripts/cr-api.mjs`; Drop's key still leads and
elixir-mcp's own service tokens remain the fallbacks. The consistency
skill's facet table drops its elixir-bot row. Tooling only; no MCP or
JSON API version moves.
