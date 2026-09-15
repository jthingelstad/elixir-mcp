-- The form discriminator is the API's bit field, not an enum of three.
--
-- 0091 checked form between 0 and 2 (0 base, 1 Evolution, 2 Hero) on the
-- strength of the reference's April 2026 survey, which had never seen 3
-- on a battle array. The first production backfill batch found it: 852
-- played-card rows across four cards (Knight, Musketeer, Valkyrie,
-- Wizard - the cards that have both forms) carry evolutionLevel 3 = 1|2,
-- both forms active in that battle. The record stores what the API
-- sends; the reference is corrected alongside (cr-agent-api-docs
-- players.md). deck_hash already treats 3 as its own form in identity.

alter table deck_card drop constraint deck_card_form_check;
alter table deck_card add constraint deck_card_form_check check (form between 0 and 3);

alter table battle_participant_card drop constraint battle_participant_card_form_check;
alter table battle_participant_card add constraint battle_participant_card_form_check check (form between 0 and 3);

comment on table deck_card is
  'The cards of a deck. form is the CR form bit field (bit 1 Evolution, bit 2 Hero; 3 = both active); each form of a card is its own slot.';
