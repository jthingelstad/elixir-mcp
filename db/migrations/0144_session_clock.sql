-- 0144: the session clock (NOTES 2026-09-19, "The session clock replayed,
-- and what a week loses"). One nullable column, instant: how many
-- battlelog reads in a row found nothing, stamped by ingest at admission
-- (0 when the log delivered battles). The planner's wait is
-- 30 min x 2^streak, never past the ceiling. Null is a row never
-- stamped: a new subject, read at the follow-up.
--
-- yield_bph, burst_bph and burst_at stay in place for now: no planner
-- reads them for a player row after this release (the clan row's
-- yield_bph is still its churn signal). The battlelog columns drop once
-- the deploy that stops writing them has settled (expand and contract).
alter table poll_state add column empty_streak integer;
comment on column poll_state.empty_streak is
  'Battlelog reads in a row that found nothing (0 after a read that delivered battles); the session clock waits 30 min x 2^streak up to the ceiling. Null: never stamped.';
