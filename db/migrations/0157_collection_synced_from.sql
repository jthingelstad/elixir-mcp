-- 0157: which live board a collection's membership follows.
--
-- The Path of Legends collections (and the top-10 clans) are re-set from
-- the live board every day by clients/boards; a curated list (Pros,
-- Creators) is edited by hand. The tools could not tell the two apart,
-- so a board collection read like a fixed cohort: its description said
-- "a snapshot" while 36 of 100 global members turned over in a day, and
-- nothing said which membership a segment read applied (Gym #116).
-- Null on a curated collection. Tiny table; additive.
alter table collection add column synced_from text;
comment on column collection.synced_from is
  'The live board this collection''s membership is re-synced from (clients/boards), e.g. ''pol:global'', ''clans:global''; null for a hand-curated collection.';
