-- The activity feed's cursor (review 2026-09-13, Part III §13.2).
--
-- elixir_events now returns one synthesized ENTRY per subject since the
-- reader's cursor, built at read time from the record and the subject
-- ledger; the cursor is therefore an instant, not an event_feed id. Null
-- means the account has never marked: the first read covers the last
-- 24 hours. events_seen_through stays until event_feed is retired.
alter table account add column activity_seen_at timestamptz;

comment on column account.activity_seen_at is
  'The activity feed bookmark: elixir_events with mark_seen advances it to the window end it returned. Null means never marked; the next read defaults to the last 24 hours.';
