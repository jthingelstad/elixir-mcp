-- The window index becomes whole and carries type (the excluded
-- breakdown counts boat, duel and deck-less rows too); the per-player
-- cover carries the same columns so a clan-scoped scan is index-only.
-- Runs after {type_backfill} has filled 0099's column. Two index builds
-- on ~470k rows: seconds each, share lock, no row rewrite.

drop index battle_participant_window;
create index battle_participant_window
  on battle_participant (battle_time)
  include (deck_hash, player_tag, outcome, type, type_class);

drop index battle_participant_player_time_cover;
create index battle_participant_player_time_cover
  on battle_participant (player_tag, battle_time desc)
  include (battle_id, clan_tag, deck_hash, outcome, type, type_class);
