-- 0315: timeline_story_subject, when each subject's stored stories were
-- last written (2026-11-23, stage 2 of the stored Timeline).
--
-- Stage 1 (0314) stored each recorded player's stories once, from an op,
-- and nothing wrote again. Stage 2 rewrites a player's stories soon after
-- the record learns something about them (an admission wakes the
-- timeline-sync lane; the jobs' five-minute home_feeds run sweeps for
-- what an admission cannot announce). Both need to know when a subject
-- was last written, and timeline_story.built_at cannot say: it moves only
-- on a row whose content changed, so a write that found nothing new
-- leaves it where it was, and a quiet player would look stale for ever.
--
-- One row per subject: written_at is when the last committed write's
-- build began, so everything the record held then is in the rows. A wake
-- older than it is already served and is skipped; a build that began
-- before it commits nothing (a newer build is in). Players only for now,
-- as in 0314. A cache's bookkeeping: rebuilt by the next write, and gone
-- with the subject's rows at 35 days by the daily retention trim
-- (packages/record/src/retention.mjs). docs/notes/2026-11-23-timeline-story-fresh.md.
--
-- A new, empty table and no foreign key: no lock on any table in use.

create table timeline_story_subject (
  subject_kind text not null check (subject_kind in ('player', 'clan')),
  subject_tag  text not null,
  written_at   timestamptz not null,
  stories      integer not null,
  build_ms     integer not null,
  primary key (subject_kind, subject_tag)
);

-- The retention trim's batches select by age.
create index timeline_story_subject_written
  on timeline_story_subject (written_at);

comment on table timeline_story_subject is
  '0315: when each subject''s timeline_story rows were last written (2026-11-23, stage 2). Bookkeeping for a cache; the record is the truth.';
comment on column timeline_story_subject.written_at is
  'When the last committed write''s build began: the record as of then is in the rows. A wake at or before it is skipped.';
comment on column timeline_story_subject.stories is
  'How many stories that build told over its span.';
comment on column timeline_story_subject.build_ms is
  'How long that build and write took, in milliseconds.';
