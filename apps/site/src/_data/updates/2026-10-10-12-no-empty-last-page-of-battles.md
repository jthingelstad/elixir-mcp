# No empty last page of battles

When a player's recorded battles fill the last page exactly, Explore no longer offers **Older battles** onto an empty page, and an agent paging `battles_query` gets a null cursor on that page instead of one more empty read. MCP 11.7.3 and JSON API 3.1.0 unchanged.
