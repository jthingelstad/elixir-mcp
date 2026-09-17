-- 0117: step three (see 0115): SET NOT NULL proven by the validated
-- checks, so no scan; then the checks go. Instant. type_class loses the
-- 'pvp' default 0095 gave it for the backfill: both copies come from
-- the same source column and neither should ever be invented. The one
-- identity-of-nothing deck (card_count 0, 0093 nulled its participants)
-- goes, and card_count is constrained.
alter table battle_participant alter column battle_time set not null;
alter table battle_participant alter column type set not null;
alter table battle_participant drop constraint bp_battle_time_nn;
alter table battle_participant drop constraint bp_type_nn;
alter table battle_participant alter column type_class drop default;
delete from deck where card_count = 0;
alter table deck add constraint deck_card_count_check check (card_count > 0);
