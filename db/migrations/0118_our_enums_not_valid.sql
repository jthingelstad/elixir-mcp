-- 0118: CHECKs on the enums that are OURS, written from fixed literal
-- sets in code (schema review 1.5). The API's enums (battle.type,
-- clan_membership.role, card.rarity, poll_state.period_type) stay open
-- by decision: ingest must never fail on a value the game adds. NOT
-- VALID here, validated in 0119, so the 240k-row rollup scan holds no
-- ACCESS EXCLUSIVE lock. {enum_census} 2026-09-17: every live value is
-- in its set.
alter table player_event add constraint player_event_type_check check (event_type in (
  'donation_reset', 'badge_earned', 'legendary_badge_earned', 'arena_changed',
  'ranked_promotion', 'best_trophies_band', 'collection_level_step',
  'career_wins_step', 'card_unlocked', 'card_leveled')) not valid;
alter table clan_event add constraint clan_event_type_check check (event_type in (
  'member_joined', 'member_left', 'role_changed', 'bracket_observed',
  'race_finished', 'week_resolved')) not valid;
alter table player_daily_battle_rollup add constraint rollup_mode_group_check check (mode_group in (
  'ladder', 'ranked', 'casual', 'war', 'challenge', 'tournament')) not valid;
alter table poll_state add constraint poll_state_hint_check check (
  hint is null or hint in ('active', 'idle', 'asleep')) not valid;
