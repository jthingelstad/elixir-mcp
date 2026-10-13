-- 0227: Cover timeline reads of battle metadata.
-- Native release acceptance (2026-10-13, #576) found month windows taking
-- 15-20 seconds. Exact plans repeatedly scanned battle's 145 MB heap for
-- ids, times and mode metadata; quiet_gaps also fetched created_at once
-- per participant. The table census estimated 101,426 rows, all visible.
-- This additive index leaves records and query semantics unchanged; the
-- existing primary key still owns identity. SHARE lock: reads continue,
-- writes wait for the bounded build; fail fast behind a conflicting writer.
set local lock_timeout = '5s';
set local statement_timeout = '10s';

create index battle_metadata_cover on battle (battle_id)
  include (battle_time, created_at, type, event_tag);

comment on index battle_metadata_cover is
  '0227: timeline metadata and learned-time lookups without reading the wide battle heap.';
