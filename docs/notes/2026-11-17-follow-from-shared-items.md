# Follow a player from a shared item

The signed-in handoff from an opaque share offers the post author or the players named by the game item. It uses the existing Follow page, which checks the current price and asks the reader to confirm. The public projection supplies the game names and tags. Clan-only items have no player suggestion.

The same release finishes the storage migration from highlights to battle posts (#1119). Before dropping the frozen table, the migration verifies every remaining highlight has its canonical item, owner, player and battle. Later edits to a post remain authoritative. Account removal and retention now refer only to canonical posts.
