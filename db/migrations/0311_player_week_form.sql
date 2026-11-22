-- 0311: a player's week's form, stored once per closed game week (2026-11-22).
--
-- The Timeline's week_form item (MCP 15.3.0) sets a closed game week's
-- win rate beside the four game weeks before it, in one mode. Computed at
-- read time it read five weeks of every followed player's battles, each
-- battle's mode by key: on the signed-in budget's synthetic record (56
-- busy players, 26 weeks) about 30,000 shared buffers a Timeline read,
-- and a seven-day window always holds a Monday 10:00Z, so nearly every
-- read paid it. On a db.t4g.small that stays small, the reading is
-- stored instead (engineering, 2026-11-22; docs/notes/2026-11-22-week-form.md).
--
-- player_week_form: the one reading a player's closed game week gives,
-- written by the jobs Lambda's weekly week_form run a grace after the
-- week ends (Monday 10:00Z), counted with battles_performance's own SQL
-- over battles the record had learned by then. Only a qualifying week
-- has a row: both sides at FORM_MIN_BATTLES decided battles, the week's
-- win rate at least WEEK_FORM_RISE above the four weeks', and of the
-- modes that qualify the one with the most decided battles in the week.
-- No row means no reading. Derived and rebuildable from the record, so
-- not a canonical table; it goes with the record at one year.
--
-- A new, empty table and no foreign key: no lock on any table in use.

create table player_week_form (
  player_tag     text not null,
  week_start     timestamptz not null,
  mode           text not null
    check (mode in ('ladder', 'ranked', 'war', 'event', 'casual')),
  week_battles   integer not null,
  week_decided   integer not null,
  week_wins      integer not null,
  week_losses    integer not null,
  week_win_rate  numeric(4, 3) not null,
  prev_decided   integer not null,
  prev_win_rate  numeric(4, 3) not null,
  computed_at    timestamptz not null default now(),
  primary key (player_tag, week_start)
);

comment on table player_week_form is
  '0311: the Timeline''s week_form reading, one row for a player''s closed game week (Monday 10:00Z to the next) that rose at least WEEK_FORM_RISE in one mode against the four game weeks before it; written by the jobs week_form run; derived, rebuildable.';
comment on column player_week_form.week_start is
  'the game week''s start, a Monday 10:00Z; it ends seven days later';
comment on column player_week_form.mode is
  'the Stats mode group the reading is in (never pooled)';
comment on column player_week_form.week_battles is
  'the week''s battles in the mode, boat defenses never (battles_performance window.battles)';
comment on column player_week_form.week_decided is
  'the week''s head-to-head wins and losses (window.decided_battles)';
comment on column player_week_form.prev_decided is
  'the four game weeks before: decided battles (compare_window.decided_battles)';
comment on column player_week_form.computed_at is
  'when the reading was written or last changed: when the Timeline learned it';
