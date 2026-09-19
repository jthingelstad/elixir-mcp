-- 0145: what the battlelog schedule costs and what it loses, per UTC day
-- (Jamie, 2026-09-19: "we should be displaying that battle log breakage
-- somewhere in the collector interface"). One row a day, written by the
-- jobs Lambda ({capture_efficiency}) for the last three days each night,
-- so a snapshot interval that closes late still lands on its day. The
-- loss is the recorder's own measurement against the game's lifetime
-- battle counter (NOTES 2026-09-19, "The session clock replayed, and
-- what a week loses"): expected is the counter's delta over a profile
-- snapshot interval, captured the battles the record holds inside it;
-- intervals with no capture-audit gap measure the modes the log never
-- shows, and that rate taken off the gapped intervals is the loss.
-- Small table, public read.
create table capture_efficiency_daily (
  day                 date primary key,
  computed_at         timestamptz not null,
  battlelog_polls     integer not null,
  productive_polls    integer not null,
  nothing_new_polls   integer not null,
  battles_captured    integer not null,
  audited_polls       integer not null,
  gaps                integer not null,
  intervals           integer not null,
  gap_intervals       integer not null,
  expected_gap        integer not null,
  captured_gap        integer not null,
  shortfall_gap       integer not null,
  expected_no_gap     integer not null,
  captured_no_gap     integer not null,
  shortfall_no_gap    integer not null,
  noise_rate          real not null,
  lost_battles        integer not null,
  players_with_gaps   integer not null
);
comment on table capture_efficiency_daily is
  'Per UTC day: battlelog polls and what they found, capture-audit gaps, and the battles the recorder lost, measured against the profile lifetime battleCount over snapshot intervals ending that day (nightly, last three days rewritten).';
comment on column capture_efficiency_daily.lost_battles is
  'shortfall_gap minus noise_rate x expected_gap, floored at zero: the battles the log rolled past before it was read.';
