# 2026-11-27 — Your friends' friendly battles suggest players

People to follow (Home's panel) and Find's Suggested take a third source:
the players your friends (the players you follow) had a friendly battle
with. Jamie, 2026-11-27: "investigate how we can use friendly battles
amongst your elixir friends to better suggest players for someone to
follow. For example, Tyler is my friend and I may know some of the folks
he does friendly battles with. This seems like one of the best signals for
players." Then: "Rank by frequency of friendlies and one would be enough
to qualify in." and "Approved: build friend-friendly suggestions in
elixir-mcp as recommended."

**The source.** `friendliesOfFriends` in `services/web-api/src/people.mjs`
reads the reader's friends as `followedByFriends` does (claims passing
`visibleFriendSql`), then each friend's own participant rows in the window
on the `battle_participant_player_time_cover` range (a `cross join
lateral` per friend, never `player_tag = any(...)`), keeping rows whose
own `type` is in `FRIENDLY_TYPES` or `CLANMATE_TYPES`. A boat battle is
neither, so it never counts. Each such battle's other players come by its
key (a lateral with `offset 0`, as in `metInBattles`). Opponents and 2v2
teammates both count. One battle qualifies; a battle counts once however
many of your friends were in it. The order is how many such battles, then
the most recent, then tag: never trophies, wins or a score ("Facts, not
advice", "Elixir rates no player").

**Who is never suggested.** The source takes the same `exclude` as the
others (every claim the reader holds, so the friend themself, and the
current automatic clanmates) and leaves out the reader's own players. A
candidate whose verified owner is in a block with the reader, either way,
is left out in the query (`ownerBlockedSql`), besides the route's
`withoutBlocked` filter.

**The reason, as data.** `why: { kind: "friend_friendly", via: { tag,
name }, battles, others, days }`: `battles` the distinct friendly battles
with any of your friends, `others` how many other friends of yours played
them, `via` the friend who played them most (ties by name, then tag).
`apps/web/src/home/logic.js` words it: "Ada played a friendly battle with
them", "Ada played 3 friendly battles with them", "Ada and 1 other friend
played 2 friendly battles with them". It is not a battle of yours, so the
player's page opens as other non-battle reasons do, not on Together. The
empty Suggested line now says friendly battles are "yours and your
friends'".

A player in more than one source is one row with every reason
(`interleave`). The sources take turns: your battles, your friends'
friendlies, the players your friends' accounts follow.

[engineering] Defaults chosen here:

- 30 days on both surfaces (`FRIEND_FRIENDLY_DAYS`): Home's panel keeps 7
  days for your own battles, but friendlies are sparse.
- Clan-chat friendlies (`CLANMATE_TYPES`) count with friend invites. A
  friend's clanmates can surface this way; your own current clanmates
  are already excluded.
- 2v2 teammates of the friend in a friendly count, as opponents do.
- Not in the starter set: second-degree guesses never go into the
  pre-ticked follow-all (`peopleSources` reads it only with `friends`,
  which the starter set turns off).
- `via` is the friend who played them most, and the reason names the
  friend, so it names a friend's friendly opponent you do not follow, as
  the approved recommendation did.
- A friend's battle with someone their verified owner is in a block with
  is left out, as `followedByFriends` leaves out that edge.
- The What's new entry is not marked for everyone's Timeline.

**Budget.** One statement more for each read that has the source:
`/api/me/people/suggested` and `/api/me/people/find` measured 14
statements (13 before; the pinned budget rises from 12 to 13, plus the
verification lookup's one), the starter set unchanged at 13. With a
followed friend's friendly seeded, the plan rules hold (no Seq Scan on
battle, battle_participant or player; no batched battle read):
suggested 328 buffers, find 802.

On the larger signed-in seed (`signed-in-budget.test.mjs`: the reader
follows 55 players, 26 weeks of battles), `/api/me/people/suggested` made
10 statements (inside its 11) but read 812 shared buffers against a
ceiling of 600: the new statement is about 424 of them, an index-only
walk of each followed friend's last 30 days on the cover (7,315 entries
over 55 ranges) that keeps the friendlies. There is no index on `type`,
and this change adds no migration, so the ceiling rises to 900, with the
reason beside it. Cost grows with how much your friends play, not with
the record.

No schema migration, no MCP tool change, no `/api/v1` change; the routes
stay member-web only.

Tests: `services/web-api/test/friend-friendlies.test.mjs` (the reason,
one battle enough, the order, a battle with two friends counted once and
`others`, never a ladder opponent, your own player, a follow, a clanmate
or the friend, a block either way with the reader or between friend and
candidate, a player in two sources one row, never in the starter set);
`people-budget.test.mjs` seeds a followed friend's friendly; the web's
`people.test.js` and the Find journey's fixture carry the new wording.
