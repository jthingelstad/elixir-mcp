# First reads and verification reads keep their limits

Adding a player still asks the game for its profile at once, so a wrong tag or the player's clan shows within minutes. You and your agents now get one of these first reads a day for each player slot you have; a player added past that is still recorded, and its first read comes with the scheduler's next round (`first_read: false`). Verify's 120 battle-log checks a day for a player now hold when the player is removed and added again. Both are on [Limits](/docs/limits). MCP 11.7.2 and JSON API 3.1.0 unchanged.
