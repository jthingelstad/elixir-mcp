# Races are read through the season roll

When a season rolls, the Clash Royale API has no river race for a few minutes to over an hour. Elixir took that gap for a clan with no race and stopped reading every race for a day, so the first training day of Season 137 went unread for the morning. A race that was there within the last six hours is now read on its usual schedule through the gap; a clan with no race for longer is still checked once a day. MCP 11.2.3 and JSON API 3.0.0 unchanged.
