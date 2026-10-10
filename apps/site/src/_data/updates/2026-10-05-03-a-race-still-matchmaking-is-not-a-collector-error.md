# A race still matchmaking is not a collector error

For a minute or two after a season rolls, the Clash Royale API answers for a new river race that has no clans yet. Elixir still sets that answer aside and reads the race again soon, but it no longer counts it as a rejected fetch on the collector's page, the status page or the weekly collector mail. MCP 11.2.3 and JSON API 3.0.0 unchanged.
