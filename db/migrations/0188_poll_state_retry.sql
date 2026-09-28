-- 0188: a failed fetch is retried in minutes, not a cadence later.
--
-- last_planned_at is stamped when a job is planned, and a non-200 submit
-- or a job that dies left that stamp in place, so the retry waited a
-- whole cadence: a battle log one cadence, a profile a day, and an
-- anchored daily board (or the events read) that errored at the 10:05Z
-- tick waited for the next board day. About 13 non-404 errors a day, but
-- one CR maintenance break at 10:05Z would have lost that board day for
-- every board in it (review 2026-09-27 §2.6, issue #69).
--
-- Ingest (a non-404 fetch error) and the lease settler (a dead job) now
-- stamp retry_at at 15 minutes, then 30, then 60; after the third try the
-- subject waits for its own cadence again. The planner treats a row as
-- due once retry_at has passed, like the incomplete-board re-read (0173),
-- and every plan clears it; a plan the cadence made (not a retry) also
-- restarts the count. A retry is planned and charged like any other plan;
-- freshness still moves only on admission, which clears both columns, and
-- the 404 hold is unchanged.
--
-- Catalog-only: a nullable column and a constant default. poll_state is
-- written by every tick and every admission, so fail fast on its lock.

set local lock_timeout = '5s';

alter table poll_state add column retry_at timestamptz;
alter table poll_state add column retry_tries smallint not null default 0;

comment on column poll_state.retry_at is
  'A retry owed at or after this instant after a non-404 fetch error or a dead job (0188); null when none is owed. Cleared by the next plan and by admission.';
comment on column poll_state.retry_tries is
  'Retries stamped since the last plan the cadence made (0188): 15, 30, then 60 minutes; at 3 no further retry is stamped. A cadence plan or an admission resets it to 0.';
