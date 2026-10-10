# A raw live read stores nothing

live_fetch, the raw read of the game an agent can make, now only fetches: the answer comes back to the agent and nothing of it is kept, so asking about a player nobody tracks no longer puts them on the record. To keep someone's history, track them. A live read on a recorded tool (players_profile, clans_roster, war_current or battles_query with live) still updates the record it answers from. MCP 11.5.1; JSON API 3.1.0 unchanged.
