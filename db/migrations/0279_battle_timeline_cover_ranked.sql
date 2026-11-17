-- 0279: Widen battle's timeline cover with the Ranked league and deck selection.
--
-- The timeline tells a Ranked sitting by the league each battle started
-- in (battle.league_number) and leaves archetype labels off decks the
-- player did not bring (battle.deck_selection: a draft, a pick, a preset),
-- 2026-11-16 (docs/notes/2026-11-16-modes-in-the-timeline.md). Both reads
-- (playerBattlesSql, clanMemberBattlesQuery) take every battle of a week
-- off battle_timeline_cover (0249); without these two columns each row
-- would fetch the wide battle heap again, the cost 0249 removed (about
-- 13,800 buffers for one clan's week).
--
-- Records and query semantics are unchanged. The build takes a SHARE
-- lock on battle (reads continue, ingest waits seconds; 0249 built the
-- same index on about 130,600 rows); the old index is dropped under
-- ACCESS EXCLUSIVE for an instant at the end and the new one takes its
-- name, so plans and tests that name battle_timeline_cover keep it.
-- Fail fast behind a conflicting writer or reader; the deploy retries.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index battle_timeline_cover_0279 on battle (battle_id)
  include (battle_time, created_at, type, event_tag, game_mode_name,
           boat_battle_side, league_number, deck_selection);

drop index battle_timeline_cover;

alter index battle_timeline_cover_0279 rename to battle_timeline_cover;

comment on index battle_timeline_cover is
  '0279: timeline metadata, learned-time, mode, boat-side, Ranked league and deck-selection lookups without reading the wide battle heap (widens 0249).';
