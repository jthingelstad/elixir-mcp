-- 0187: what the one global budget was charged, by hour and lane.
--
-- The token bucket (budget_state) says what is left, never what was
-- spent or by whom. Until review 2026-09-27 §4.1 only the planner
-- charged it, and it charged every plan whether or not the enqueue
-- inserted a row; live mints never charged it at all, so the live
-- reserve was the planner abstaining, not a reservation. Now the tick
-- charges the bulk rows it inserted and each live mint charges one
-- token, and each charge is added to its hour's row here, which is how
-- /api/public/status shows the live lane spending the one budget.
--
-- Two rows an hour at most; the tick deletes rows older than eight
-- days. A new table, so no lock on anything live traffic uses.
create table budget_charge (
  hour    timestamptz not null,
  lane    text not null check (lane in ('bulk', 'live')),
  charged int not null default 0,
  primary key (hour, lane)
);
