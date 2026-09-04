# About Elixir MCP

Elixir MCP is a **data product** for Clash Royale players: it records the
history the official API doesn't keep, and serves it to your own AI
agent through a remote MCP server.

The Clash Royale API only answers "what is true right now" — your last
~25 battles, your current trophies. Elixir MCP polls continuously,
stores every battle once (no matter how many members observed it),
derives daily snapshots, war records, and events from the stream, and
exposes it all as tools your agent can reason over: *"how has my ladder
win rate trended since I swapped Cannon for Musketeer?"* is a real,
answerable question here.

**How you use it:** request access, claim your player tag, turn on
recording, and connect `https://elixir.poapkings.com/mcp` to Claude or
any MCP client. The [Explore](/explore) page shows you exactly what your
agent sees.

**Who runs it:** this is a hobby service operated by Jamie Thingelstad
for the POAP KINGS clan and friends. It is free, and paid tiers are not
planned (see [Terms](#terms)).

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
