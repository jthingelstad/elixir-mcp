-- The deck JSON leaves the participant row (Phase C of 0091).
--
-- Every reader has moved onto deck / deck_card / battle_participant_card
-- (3.4.0): battles_query renders `deck` from the rows, the verify routes
-- read a deck's ids from its identity, nothing explodes JSON. The column
-- was 612 MB of heap inline on 468k rows (TOAST unused - each deck fit
-- the page) against 88 MB of shared buffers, which is why a clan-scoped
-- meta call over 12k rows spent 3.6 of 3.8 s in disk reads. Dropping it
-- frees the space only after a rewrite; the migrate op {rewrite_table}
-- runs VACUUM FULL deliberately, outside this transaction.
--
-- The byte-true capture is the payload archive in S3, as it always was;
-- support_cards was never written (folded into the deck) and goes too.

alter table battle_participant drop column deck;
alter table battle_participant drop column support_cards;
