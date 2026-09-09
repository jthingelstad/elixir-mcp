-- The game's own "last seen", captured instead of discarded.
--
-- Jamie, 2026-09-09: "capturing memberList.lastSeen would be an important
-- data item for us to have on a profile. I don't think we should drop that."
--
-- It arrived on every clan roster poll and was thrown away. Two reasons that
-- is worse than it sounds:
--
--   IT IS NOT AVAILABLE ANYWHERE ELSE. /players/{tag} has no lastSeen; it
--   exists only inside a clan's memberList. So it is obtainable only while a
--   player is in a clan we poll, and only for the moments we polled. Every
--   poll we did not store is gone for good.
--
--   IT IS THE PREDICATE THE GAME ITSELF USES. Verified 2026-09-09 against a
--   live payload: the five members missing from a clan's currentriverrace
--   participants were exactly the five whose lastSeen predated the race
--   start, while all 44 included had one after it. Not battling does not
--   exclude a member and joining late does not either. So this column is
--   what turns "not in the race" into "has not opened the game since Monday",
--   which is the difference between a reconciliation field and a nudge list.
--
-- Deliberately NOT called last_seen_at: player.last_seen_at already exists
-- and means when OUR recorder last saw the row, which is a different fact and
-- would be a cruel name collision on an inactivity query.
alter table player add column game_last_seen_at timestamptz;

comment on column player.game_last_seen_at is
  'Clash Royale''s own lastSeen from a clan memberList entry, in UTC. When the
   PLAYER was last active in game, as against player.last_seen_at which is when
   this recorder last observed them. Null until first seen in a polled clan
   roster; never available for a player who is not in a recorded clan.';
