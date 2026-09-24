-- 0173: an incomplete board is re-read once, and the re-read supersedes it.
--
-- Minutes after the 10:00Z reset on 2026-09-24 the API served the global
-- Path of Legends board without 392 of its players (cutoff -61, a #36
-- player absent), and the daily read kept it (Gym #342). The read stays
-- at the reset (Jamie, 2026-09-11); a full board whose cutoff fell 40 or
-- more below the previous snapshot's is flagged at ingest, the planner
-- reads it once more after ranking_board.reread_at, and a later snapshot
-- the same board-day supersedes it (Jamie, 2026-09-24). The suspect row
-- is kept (canonical tables are lossless); readers skip a superseded one.

alter table ranking_snapshot add column suspect boolean not null default false;
alter table ranking_snapshot add column superseded_at timestamptz;
alter table ranking_board add column reread_at timestamptz;

comment on column ranking_snapshot.suspect is
  'Flagged at ingest: a full board whose cutoff fell 40+ below the previous snapshot''s (Gym #342).';
comment on column ranking_snapshot.superseded_at is
  'When a later read the same board-day replaced this suspect snapshot; readers skip a superseded snapshot.';
comment on column ranking_board.reread_at is
  'A one-time re-read owed at or after this instant, set when a suspect snapshot is recorded; satisfied by the first read planned after it.';
