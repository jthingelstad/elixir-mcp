-- 0286: player_event may hold four new moments from profile data the
-- record already keeps (the owner, 2026-11-17: "I feel like elixir has
-- more info that would be interesting in the timeline and is already
-- collecting"; docs/notes/2026-11-17-profile-moments.md):
--
--   card_maxed          a card reaching its top level, at the one seam
--                       that maps rarity-relative levels (displayLevel,
--                       +(16 - maxLevel)): card_id, level.
--   king_tower_leveled  the profile's King Tower level rising: level,
--                       prior_level.
--   challenge_best_run  the profile's best challenge run rising:
--                       value_before, value_after.
--   twelve_win_run      a 12-win challenge badge's progress rising
--                       (Classic12Wins, Grand12Wins): badge_name,
--                       value_before, value_after (completed 12-win
--                       runs), level and prior_level when its tier rose.
--
-- Going forward only, as 0192: the projectors emit these on the second
-- observation of a value that moved, never on a first observation, a
-- null baseline, a replay or a backfill. No new column: each kind fits
-- the typed columns 0124 made.
--
-- badge_earned's step (unused on that kind until now) becomes the rung
-- the level-up crossed, written from this deploy on: a Mastery badge's
-- multiple of five or its top level, any other tiered badge's new level.
-- The timeline tells a badge_earned row with a step; a row without one
-- (every row before this deploy, and a Mastery level between rungs)
-- keeps the rule it was written under, so the deploy surfaces no old row.
--
-- player_event_type_check is replaced NOT VALID, so the swap holds
-- ACCESS EXCLUSIVE only for the catalog change; 0287 validates it under
-- SHARE UPDATE EXCLUSIVE. Every live row already satisfies the new set,
-- a superset of the old. Old code serving while this commits never
-- writes the new kinds.
set local lock_timeout = '5s';

alter table player_event
  drop constraint player_event_type_check,
  add constraint player_event_type_check check (event_type in (
    'donation_reset', 'badge_earned', 'legendary_badge_earned', 'arena_changed',
    'ranked_promotion', 'best_trophies_band', 'collection_level_step',
    'career_wins_step', 'card_unlocked', 'card_leveled', 'card_form_unlocked',
    'card_maxed', 'king_tower_leveled', 'challenge_best_run', 'twelve_win_run'))
  not valid;

comment on column player_event.step is
  'The step kinds'' rung (best_trophies_band: the 500 band; career_wins_step, collection_level_step: the step); on card_form_unlocked (0192) the form''s bit, 1 Evolution or 2 Hero; on badge_earned (0286, written from that deploy on) the rung the level-up crossed, null when it crossed none.';
