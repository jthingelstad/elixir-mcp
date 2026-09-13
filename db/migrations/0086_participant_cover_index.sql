-- 0086: clans_participation read the participant HEAP twice.
--
-- EXPLAIN ANALYZE on the live database (2026-09-13, POAP KINGS, 47
-- members, 8 weeks): battles_by_week and war_battles_by_day were 8.4 s
-- EACH, both the same Bitmap Heap Scan on battle_participant - 26k rows
-- scattered over 14.5k pages, 8 s of it I/O. The (player_tag,
-- battle_time) index found the rows but carried neither battle_id nor
-- clan_tag, so every row was fetched from the heap, and the heap row is
-- wide (deck, tower_hp, support_cards jsonb). Carrying the two columns
-- the reads need makes them index-only: ~200 index pages instead of
-- 14.5k heap pages. Every slow page in Elixir Clan was this one call.
--
-- The old index is superseded: same leading columns, so every read that
-- used it uses this one.
create index battle_participant_player_time_cover
  on battle_participant (player_tag, battle_time desc)
  include (battle_id, clan_tag);

drop index battle_participant_player_time;
