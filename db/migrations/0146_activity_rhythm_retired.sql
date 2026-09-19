-- 0146: the 24x7 rhythm retires from player_activity (Jamie, 2026-09-19:
-- the year of days is the product; the rhythm tile was not worth its
-- place, and the scheduler, having scored it, never read it - NOTES
-- that day). Expand and contract: this migration only lets the nightly
-- job stop writing the four rhythm columns (NOT NULL off; instant on a
-- small table); the columns themselves drop in a later migration once
-- no deployed code names them. The row keeps what the year needs: the
-- not-recorded marks, recorded_from, first/last battle, battles_28d.
alter table player_activity
  alter column rhythm drop not null,
  alter column rhythm_weight drop not null,
  alter column rhythm_battles drop not null,
  alter column half_life_days drop not null;
comment on column player_activity.rhythm is
  'Retired 2026-09-19; no writer, no reader. Dropped by a later migration.';
