# 2026-11-23 — Together for players you met

Two changes to how Elixir uses the battles two players share.

**A boat battle is never a meeting.** People to follow and Find's From
your battles counted a boat battle as meeting the clan whose boat was
attacked, so a raid suggested the defenders and added to "against".
`metInBattles` (`services/web-api/src/people.mjs`) now skips a
participant row whose own `type` is `boatBattle`, which needs no battle
lookup and keeps the OFFSET 0 guard; the pair record already applied the
same rule. The starter set's "played" check also leaves out boat
defenses (`notBoatDefense`), since a defense is not the member's battle
("A boat defense is not the member's battle", `docs/DECISIONS.md`).

**Together on any player you met.** The 2026-11-18 Together tab
(`docs/notes/2026-11-18-our-games-together.md`) answered only for a
followed friend. The pair route now answers for any player but the
reader's own, unless either side has blocked the other's verified owner
(`ownerBlockedSql` in `@elixir-mcp/claims`, which `visibleFriendSql` now
uses too). Person-only, the rate limit, current verification and the
boat exclusion are unchanged. A block either way is a 404, as before.

[engineering] Defaults chosen here:

- The tab shows on a followed visible friend as before (keeping the
  verify and "no games yet" states), and otherwise only when there is a
  game to show: `you.pair_games`, the distinct battles between the
  reader's verified own players and this player in the last 30 days,
  boats excluded. `you.pair` stays a boolean.
- The count is read once per player-page visit by a verified person: one
  named-range read per own tag (`playerPairCount` in
  `@elixir-mcp/record/player-pair`), from the other player's side when
  they are unrecorded. A joined or unnested tag planned a participant
  scan, so the tags are read one at a time.
- The tab label carries the count ("Together 3", with "games" for screen
  readers).
- `/home/player/<tag>?tab=together` opens the tab. People to follow,
  Find's From your battles and the starter set link there for a player
  met in battle; other reasons open the Timeline.
- The pair view's empty-across-a-block copy no longer mentions following.

The session page's pairs are unchanged. No schema, MCP or JSON API change;
the routes are member-web only.

Tests: a boat battle alone makes no battles suggestion and is not counted
against; the pair route answers a non-followed player you met, 404s
across a block in either direction and on your own player, refuses an
agent and asks an unverified reader to verify; `you.pair` and
`pair_games` both ways; the web tab label, count and `?tab=together`.
The plan fixture pins the own-side count to keyed reads.
