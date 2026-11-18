# Clanmate connections

Jamie asked for sharing a current clan to connect two players automatically.
The reader can choose Friend, then mark a friend close. Unfriending restores
Clanmate while they share the clan. Leaving clears only the automatic
connection. A block takes precedence in either direction.

The signed-in site uses a person’s verified primary and alts to find shared
rosters. Find lists existing connections and removes them from suggested
friends. The player page names the shared clan and keeps friending voluntary.
A shared clan uses no follow slot and creates no follow, notification, game
recording job or private Clan permission.

The member Timeline includes current clanmates’ posts and questions. Its
Clan filter and new-item count use the same current audience. Friend
notifications still control game activity. Email, push, RSS, the JSON API
and MCP keep their existing audiences. Those are engineering defaults.

Membership comes from actual projected observations. A newer profile
indicating departure or another clan invalidates an older roster. A stale
roster cannot undo a newer move. For incidental clans with a verified member,
the roster retains enough public identity, role and membership to show their
peers. Full historical recording still follows the existing recording scopes.

Migration 0305 adds nullable observation fields without discarding any
membership history. Only unambiguous retained profile evidence at the exact
admitted instant is backfilled. Later profile and roster reads supply fresh
evidence. Migration 0306 indexes membership history by player so incoming rosters
can check a named player’s closed intervals without scanning other clans’ history.
Ordinary account blocks continue to cover a member’s verified
players. The close-friend star remains private to the reader.
