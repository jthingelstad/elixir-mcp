# Completed Drop games on player timelines

Elixir owns the `elixir-drop-games` queue and its dead-letter queue. Timeline Sync checks the emitting account's current verified claim, admits one player fact per game ID and retries failed records individually. The player and followers see the result and highlights in Elixir. Local hands stay in Drop. MCP 13.14.0 adds the `drop_game` kind.
