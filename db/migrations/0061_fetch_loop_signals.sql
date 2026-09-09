-- 0061: two cadence signals the fetch-loop audit found missing
-- (docs/FETCH-LOOP-AUDIT-2026-09-09.md). Additive, nullable; NULL means
-- "no signal" and the planner behaves exactly as before.
--
--   burst_bph    the fastest this player has recently filled the ~30-entry
--                battlelog: max battles in any 6-hour window over the last
--                14 days, divided by 6. Derived from battle TIMESTAMPS at
--                admission, so a poll that already overflowed still learns
--                the true rate (the yield EWMA cannot: it only ever sees
--                30 / interval). The planner bounds the battlelog cadence
--                by half the time this rate needs to fill the log.
--   burst_at     when burst_bph was computed; the bound expires with it.
--   last_read_at when a reader last asked about this subject through a
--                tool (stamped at subject resolution, best-effort). The
--                planner caps the battlelog cadence for a day after a
--                read, so the players people actually ask about are not
--                the ones parked on the 24-hour fairness clamp.
alter table poll_state add column burst_bph numeric;
alter table poll_state add column burst_at timestamptz;
alter table poll_state add column last_read_at timestamptz;

comment on column poll_state.burst_bph is
  'Max battles in any 6h window over the trailing 14 days / 6, computed at battlelog admission. NULL = no signal.';
comment on column poll_state.burst_at is
  'When burst_bph was computed. The loss-aware cadence bound ignores a value older than 14 days.';
comment on column poll_state.last_read_at is
  'Last time a reader resolved this subject through a tool. The battlelog cadence is capped for 24h after.';
