-- 0134: the backfill's race lane (time-series review Part 5, as carried
-- in by the Phase 1 verification): war_period_log can only recover a
-- season's earlier sections from the archived currentriverrace
-- payloads, so the lane walks those receipts through the race
-- projector's series half. One check widened; instant.
alter table series_backfill_state drop constraint series_backfill_state_lane_check;
alter table series_backfill_state add constraint series_backfill_state_lane_check
  check (lane in ('clan', 'player', 'race', 'battle'));
