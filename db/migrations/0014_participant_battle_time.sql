-- 0014: R1 (DB-AUDIT) — ingest cost must not scale with career length.
--
-- The rollup refresh filters a player's battles by day, but the only
-- player-leading index is (player_tag, battle_id): every refresh walked
-- the player's ENTIRE career (censused live: battlelog projector cost
-- grew 153ms -> 437ms over one night of history growth). battle_time is
-- canonical and immutable, so denormalizing it onto the participant row
-- is safe; (player_tag, battle_time) makes day refreshes O(day).
alter table battle_participant add column battle_time timestamptz;

update battle_participant bp
set battle_time = b.battle_time
from battle b
where b.battle_id = bp.battle_id and bp.battle_time is null;

create index battle_participant_player_time
  on battle_participant (player_tag, battle_time desc);
