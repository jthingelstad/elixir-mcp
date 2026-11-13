-- 0265: A player's duel rounds by player.
-- battle_participant_round had only its key (battle_id, player_tag, round).
-- Stats' Cards tab (battles_cards, through duelGamesSql) reads the
-- player's duel rounds beside their games; with no index led by the
-- player the planner either read the whole round table or, fenced to
-- probe it by key, chose to hash-join every battle (2026-11-13, on a
-- synthetic year of about 118,000 battles: 3,581 shared buffers for the
-- reader's season of cards, with a Seq Scan of battle). With this index
-- the same read is 675 buffers and touches no table whole.
-- Records and query semantics are unchanged. Not sized against
-- production here: the round table holds a row per duel round only
-- (on the synthetic year, 13,916 rows and an 888 kB index).
-- The build takes a SHARE lock (reads continue, ingest waits seconds).
-- Fail fast behind a conflicting writer; the deploy retries.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index battle_participant_round_player
  on battle_participant_round (player_tag, battle_id);

comment on index battle_participant_round_player is
  '0265: a player''s duel rounds (Stats'' Cards tab), probed by player.';
