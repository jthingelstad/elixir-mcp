-- 0081: Verify proves a claim with a BATTLE, not a deck slot (2026-09-12).
--
-- The deck-slot challenge (0080) was accepted against the live API on
-- King Thing and failed on Supercell's side: /players/{tag}.currentDeck
-- did not reflect an in-game deck-slot change for over an hour with no
-- battle played (probed once a minute; the game was closed at 13:56Z and
-- nothing moved). The battle log is fresh within a minute of a match and
-- already records the deck each participant played, so the proof is
-- now: a battle played after the brief in which this player's deck is
-- exactly the eight target cards. The result of that battle is shown at
-- the unlock. Method 'deck_slot' stays in the check so the day's rows
-- remain readable.

alter table claim_challenge drop constraint claim_challenge_method_check;
alter table claim_challenge
  add constraint claim_challenge_method_check
  check (method in ('deck_slot', 'deck_battle'));
alter table claim_challenge alter column method set default 'deck_battle';
alter table claim_challenge add column proof_battle_id text;
comment on column claim_challenge.proof_battle_id is
  'The battle (battle.battle_id) whose deck proved the claim; null until verified.';
