-- 0192: player_event may hold card_form_unlocked, an Evolution or Hero
-- form a player newly unlocked (issue #110; review 2026-09-27 §7.2).
--
-- A form unlock is the collection change players care about most and the
-- one battles_deck_upgrades recommends, but player_card.evolution_level
-- was overwritten in place and the change detection read only level, so
-- a form unlocked silently. From this deploy the collection projector
-- emits one card_form_unlocked per form bit newly set (evolutionLevel is
-- a bit field: 1 Evolution, 2 Hero). Going forward only: no backfill
-- (Jamie's standing answer for card history, 2026-09-11), and a replay
-- writes rows, never moments.
--
-- The row carries card_id and the form's bit in step (1 Evolution,
-- 2 Hero); the reader (services/mcp/src/event-payloads.mjs) names it.
-- No new column: a form is one of two bits, and step is this kind's
-- discriminator as it is the rung for the step kinds.
--
-- player_event_type_check (0118) is replaced NOT VALID, so the swap holds
-- ACCESS EXCLUSIVE only for the catalog change; 0193 validates it under
-- SHARE UPDATE EXCLUSIVE. Every live row already satisfies the new set,
-- a superset of the old. Old code serving while this commits never
-- writes the new kind.
set local lock_timeout = '5s';

alter table player_event
  drop constraint player_event_type_check,
  add constraint player_event_type_check check (event_type in (
    'donation_reset', 'badge_earned', 'legendary_badge_earned', 'arena_changed',
    'ranked_promotion', 'best_trophies_band', 'collection_level_step',
    'career_wins_step', 'card_unlocked', 'card_leveled', 'card_form_unlocked'))
  not valid;

comment on column player_event.step is
  'The step kinds'' rung (best_trophies_band: the 500 band; career_wins_step, collection_level_step: the step); on card_form_unlocked (0192) the form''s bit, 1 Evolution or 2 Hero.';
