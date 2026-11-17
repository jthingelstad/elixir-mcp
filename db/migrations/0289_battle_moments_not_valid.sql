-- 0289: player_event may hold the timeline's second batch of moments,
-- the ones the battle record and the Ranked ledger can tell (the owner,
-- 2026-11-17: "In general we were filtering a lot of things that now a
-- timeline would get value from ... Feel free to change elixirs data
-- engine as needed as well"; docs/notes/2026-11-17-deck-switch.md):
--
--   deck_switched           a deck the player had not played in one mode
--                           for 14 days, played 3 times or more in that
--                           mode within 7 days: mode_group, deck_hash
--                           (the run's most played deck), prior_deck_hash
--                           (the deck played most in that mode in the 14
--                           days before), battles and wins (as of the
--                           delivery that crossed the third battle),
--                           battle_id (the first battle with it).
--   ranked_season_finished  a Ranked season's final league, once the
--                           player's own profile has rolled past it:
--                           season_month, league_to, value_after (the
--                           rating, Ultimate Champion only).
--   card_first_win          the first win with a card or form unlocked
--                           since the previous profile read: card_id,
--                           step (the form's bit, null for the card
--                           itself), battle_id.
--
-- Going forward only, as 0192 and 0286: each is written from a battle or
-- a profile the record learns after this deploy, never from a first
-- observation, a replay or a backfill. The five columns are nullable,
-- with no default, so adding them is a catalog change. deck_hash has no
-- foreign key: deck rows are never deleted (retention.mjs keeps them).
--
-- player_event_type_check is replaced NOT VALID, so the swap holds
-- ACCESS EXCLUSIVE only for the catalog change; 0290 validates it under
-- SHARE UPDATE EXCLUSIVE. Every live row already satisfies the new set,
-- a superset of the old. Old code serving while this commits never
-- writes the new kinds or the new columns.
set local lock_timeout = '5s';

alter table player_event
  add column mode_group text,
  add column deck_hash text,
  add column prior_deck_hash text,
  add column battles integer,
  add column wins integer,
  add column season_month text,
  drop constraint player_event_type_check,
  add constraint player_event_type_check check (event_type in (
    'donation_reset', 'badge_earned', 'legendary_badge_earned', 'arena_changed',
    'ranked_promotion', 'best_trophies_band', 'collection_level_step',
    'career_wins_step', 'card_unlocked', 'card_leveled', 'card_form_unlocked',
    'card_maxed', 'king_tower_leveled', 'challenge_best_run', 'twelve_win_run',
    'deck_switched', 'ranked_season_finished', 'card_first_win'))
  not valid;

comment on column player_event.mode_group is
  'deck_switched (0289): the mode group the switch was in (ladder, ranked or war); modes are never pooled.';
comment on column player_event.deck_hash is
  'deck_switched (0289): the most played deck of the new archetype in the run that made the switch.';
comment on column player_event.prior_deck_hash is
  'deck_switched (0289): the deck played most in that mode in the 14 days before the switch.';
comment on column player_event.battles is
  'deck_switched (0289): battles with the new archetype in that mode, from its first through the delivery that crossed the third.';
comment on column player_event.wins is
  'deck_switched (0289): wins among those battles.';
comment on column player_event.season_month is
  'ranked_season_finished (0289): the Ranked season the result closed, as season.season_month.';
