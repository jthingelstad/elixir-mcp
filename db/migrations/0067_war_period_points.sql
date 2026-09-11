-- Current-race standings expose two different counters. fame is the boat's
-- cumulative score banked at each war-day close; periodPoints is the score in
-- the day currently being fought and can reset between observations.
alter table war_week_clan
  add column period_points integer,
  add column period_points_observed_at timestamptz;

comment on column war_week_clan.period_points is
  'Current war-day score from clans[].periodPoints; distinct from banked fame.';
