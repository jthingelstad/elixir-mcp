-- The card rows' indexes were 1.68 GB on a 4.5 GB database with 88 MB
-- of shared buffers; every meta call was paying for that in disk reads
-- (EXPLAIN ANALYZE BUFFERS on 2026-09-15: 3.6 of 3.8 s of a clan deck
-- aggregate was shared read time; the plans themselves were fine).
--
-- battle_participant_card is reached by its primary key prefix
-- (battle_id, player_tag) from a participant in every reader - the card
-- filters, card meta, battles_cards - so the two secondary indexes that
-- each repeated the 64-character battle_id for 4.2M rows served nothing.
-- Corpus-wide "which battles used card X" goes through the identity:
-- deck_card (card_id) -> deck_hash -> battle_participant, which needed
-- an index leading with deck_hash and did not have one (the only deck
-- index led with player_tag, so the contract's deck_hash-alone mode on
-- battles_query was a sequential scan too).

drop index battle_participant_card_card;
drop index battle_participant_card_player;

create index battle_participant_deck_time
  on battle_participant (deck_hash, battle_time desc)
  include (player_tag, outcome)
  where deck_hash is not null;
