-- The timeline reads a clan's battles by clan_tag and a window, and asks
-- "what did the record learn between two instants" by battle.created_at.
-- Neither had an index: a one-member clan's entry took two seconds of
-- sequential scans over battle_participant (2026-09-14, first live read).
create index battle_participant_clan_time
  on battle_participant (clan_tag, battle_time desc)
  include (battle_id, player_tag);

create index battle_created_at on battle (created_at);
