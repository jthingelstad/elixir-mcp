-- 0150: the contract half of two retirements (NOTES 2026-09-19 "Adaptive
-- polling becomes the session clock", accepted 2026-09-21). No deployed
-- code has named these since that release: the nightly job stopped
-- writing the rhythm (0146) and the planner stopped reading the burst
-- bound (0144). Small tables, no rewrite.
alter table player_activity
  drop column rhythm,
  drop column rhythm_weight,
  drop column rhythm_battles,
  drop column half_life_days;
alter table poll_state
  drop column burst_bph,
  drop column burst_at;
