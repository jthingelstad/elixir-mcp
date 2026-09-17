-- 0117: step three (see 0115): SET NOT NULL proven by the validated
-- checks, so no scan; then the checks go. Instant. type_class loses the
-- 'pvp' default 0095 gave it for the backfill: both copies come from
-- the same source column and neither should ever be invented. The one
-- identity-of-nothing deck (card_count 0) goes, and card_count is
-- constrained. 0093 nulled the participants it found without a deck
-- row; this hash HAS a row, and the first run of this migration
-- (2026-09-17 13:4xZ) found the validated 0113 key still pointing a
-- participant at it. The same rule runs here, before the delete: an
-- empty list has no identity, so those participants carry null.
alter table battle_participant alter column battle_time set not null;
alter table battle_participant alter column type set not null;
alter table battle_participant drop constraint bp_battle_time_nn;
alter table battle_participant drop constraint bp_type_nn;
alter table battle_participant alter column type_class drop default;
update battle_participant set deck_hash = null
 where deck_hash in (select deck_hash from deck where card_count = 0);
delete from deck_card where deck_hash in (select deck_hash from deck where card_count = 0);
delete from deck where card_count = 0;
alter table deck add constraint deck_card_count_check check (card_count > 0);
