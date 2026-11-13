# The JSON API is Sign in with Elixir, and nothing else

`/api/v1` now answers one request: `GET /api/v1/me`, who a signed-in
person is and the players they follow, for an app using Sign in with
Elixir. It also says the account's id now, the same `sub` that
`/oauth/userinfo` gives. Everything else under `/api/v1` is gone and
answers 404: the game clock, the clan directory and a clan's roster,
participation, war history and live read; a player's profile, battles,
follows, highlights, names and facts; profile refreshes, adding a
player, cheers and feedback; and the integration keys that called them. Elixir has people and their agents, and an agent reads
through MCP.

Nothing you connected to MCP changes. A key from Admin → Integrations no
longer opens anything, and that page is gone.

MCP 13.0.0, unchanged, and JSON API 5.0.0, a major.
