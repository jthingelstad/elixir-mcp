-- 0314: timeline_story, a subject's stories stored as the builder told
-- them (2026-11-23, stage 1 of the stored Timeline).
--
-- The Timeline is computed per reader on every read outside Home:
-- buildTimeline (packages/tools/src/activity/entries.mjs) reads each
-- subject's battles, ledger, snapshots and moves again for every reader.
-- MCP elixir_timeline averaged 36 queries and 1.2 s of database time a
-- call, p95 4.8 s, with timeouts. The direction is to store each
-- subject's stories when the record learns something about it, so a read
-- is one select and a viewer layer (nicknames, live overlays, merge,
-- filter, cap, and the reader's time zone). Nothing that depends on a
-- viewer is stored: no nickname, no `text`, no `local`
-- (docs/notes/2026-11-23-timeline-story-store.md).
--
-- This stage stores and compares only. The {timeline_story_backfill} op
-- fills the last 35 days, the player page compares its computed timeline
-- with the rows and logs the difference, and no reader serves a row yet.
-- Writes on admission are stage 2; until then a row is as old as the op
-- that wrote it. Rows older than 35 days go in the daily retention trim
-- (packages/record/src/retention.mjs). A cache: the record stays the
-- truth, and every row can be rebuilt from it.
--
-- A new, empty table; no lock on anything else.

create table timeline_story (
  subject_kind text not null check (subject_kind in ('player', 'clan')),
  subject_tag  text not null,
  story_id     text not null,
  kind         text not null,
  section      text not null,
  revision     integer not null,
  at           timestamptz not null,
  sort_at      timestamptz not null,
  observed_at  timestamptz not null,
  visibility   text not null,
  content_hash text not null,
  built_at     timestamptz not null default now(),
  item         jsonb not null,
  primary key (subject_kind, subject_tag, story_id)
);

create index timeline_story_subject_observed
  on timeline_story (subject_kind, subject_tag, observed_at desc);
create index timeline_story_subject_sort
  on timeline_story (subject_kind, subject_tag, sort_at desc);
-- The daily trim's batches select by age across every subject; without
-- this each batch would scan the table.
create index timeline_story_sort_at on timeline_story (sort_at);

comment on table timeline_story is
  '0314: a subject''s timeline stories as the builder told them with no viewer (2026-11-23). A cache of buildTimeline''s output; the record is the truth.';
comment on column timeline_story.subject_kind is
  'Whose timeline the story is on: player, or clan (no clan rows are written yet).';
comment on column timeline_story.story_id is
  'The item''s id (storyId, entries.mjs): the happening, not the reader, so a story on two subjects carries one id on both.';
comment on column timeline_story.revision is
  'How far the story has grown: a sitting''s battles, 1 for a moment.';
comment on column timeline_story.at is
  'When it happened first (a sitting''s first battle).';
comment on column timeline_story.sort_at is
  'When the story last moved (a sitting''s last battle, else at): what an occurred read selects and orders by, and what retention trims by.';
comment on column timeline_story.observed_at is
  'When the record learned it: what an observed read selects by.';
comment on column timeline_story.visibility is
  'itemVisibility: public, member, clan, player, leaders or owner.';
comment on column timeline_story.content_hash is
  'sha256 of the stored item, keys sorted: a row is rewritten only when it or the revision changed.';
comment on column timeline_story.built_at is
  'When this row''s content was last written.';
comment on column timeline_story.item is
  'The unfinished item: no text, local, at_unix, late, visibility, publishable, schema or nickname. Server-only fields as _spark, _deck and _evidence_source (storedItem).';
