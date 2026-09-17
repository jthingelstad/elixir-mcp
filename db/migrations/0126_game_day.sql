-- 0126: the game day, one function (time-series review 3.1; Jamie,
-- 2026-09-17: "the day is the game's day"). A series row's day key is
-- the date whose 10:00Z start the observation falls after, which is
-- the same partition as war_period: a war day, a season roll (first
-- Monday 10:00Z) and a series row never straddle. UTC arithmetic only,
-- so DST cannot move it (the 0105 lesson). Timezone stays a display
-- concern. Instant: one function, nothing rewritten; the snapshot
-- table moves onto it by the {snapshot_rekey} op, never here.
create or replace function game_day(at timestamptz) returns date
  language sql immutable parallel safe strict
  as $$ select ((at at time zone 'UTC') - interval '10 hours')::date $$;
comment on function game_day(timestamptz) is
  'The game day an instant belongs to: the date whose 10:00Z start it falls after (the river race and season grid, war_period). Immutable UTC arithmetic; the day key of every daily series table.';
