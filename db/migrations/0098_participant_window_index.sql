-- One covering index for every whole-window read on participants.
--
-- 0095's prior index carried only outcome. The window scans that meta,
-- synergy and the corpus prior run all want the same four columns of a
-- pvp participant with a deck - battle_time, deck_hash, player_tag,
-- outcome - and nothing from the heap. With them INCLUDEd, a 28-day
-- corpus scan is an index-only read of ~30 MB instead of 138 MB of heap
-- plus 323k random battle joins (the joins went with 0095: type_class is
-- on the row; battle is joined only for a mode filter's battle.type).

drop index battle_participant_prior;
create index battle_participant_window
  on battle_participant (battle_time)
  include (deck_hash, player_tag, outcome)
  where deck_hash is not null and type_class = 'pvp';
