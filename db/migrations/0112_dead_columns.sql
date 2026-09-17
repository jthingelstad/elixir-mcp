-- 0112: columns nothing writes (schema review 1.7, plan step 11). Instant.
--   battle.modifiers            - hard-coded null on every row; the API puts
--                                 modifiers on the participant, not the battle
--   war_attendance_day.finalized - never written; read into a map that never
--                                 reached a response
--   player_daily_battle_rollup.expected_battle_delta / completeness_ratio /
--   is_complete                 - retired by 0057, null on every row
alter table battle drop column modifiers;
alter table war_attendance_day drop column finalized;
alter table player_daily_battle_rollup
  drop column expected_battle_delta,
  drop column completeness_ratio,
  drop column is_complete;
