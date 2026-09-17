-- 0113: validate the participant -> deck key (plan step 8). Alone in its
-- transaction on purpose: VALIDATE CONSTRAINT scans 577k rows under
-- SHARE UPDATE EXCLUSIVE, which blocks no read or write, and it holds
-- no ACCESS EXCLUSIVE lock because nothing else in this transaction
-- takes one (0099's lesson: whatever an ALTER takes, the transaction
-- keeps to its end). {enum_census} on 2026-09-17 13:2xZ: 0 orphans.
alter table battle_participant validate constraint battle_participant_deck_fk;
