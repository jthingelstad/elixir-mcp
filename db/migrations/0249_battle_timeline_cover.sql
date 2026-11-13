-- 0249: Widen battle's timeline cover with mode and boat side (#649).
-- Acceptance timed elixir_timeline#1 (King Thing, seven days) at about
-- 10.5 s cold; warm it reads in about 2 s. The clan member-battles read
-- (clanMemberBattlesQuery) still fetched every battle row from the 145 MB
-- heap through battle_pkey for game_mode_name and boat_battle_side, about
-- 13,800 buffers for one clan's week (explain_timeline, 2026-11-13).
-- battle_metadata_cover (0227) already serves the learned-time and window
-- reads; this index keeps its key and columns and adds those two, so it
-- replaces it and the old one is dropped here.
-- Records and query semantics are unchanged; the primary key still owns
-- identity. Sized with {tables} 2026-11-13: about 130,600 rows, 17,700
-- heap pages. The build takes a SHARE lock (reads continue, ingest waits
-- seconds); the drop takes ACCESS EXCLUSIVE for an instant at the end.
-- Fail fast behind a conflicting writer or reader; the deploy retries.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index battle_timeline_cover on battle (battle_id)
  include (battle_time, created_at, type, event_tag, game_mode_name,
           boat_battle_side);

comment on index battle_timeline_cover is
  '0249: timeline metadata, learned-time, mode and boat-side lookups without reading the wide battle heap (replaces 0227 battle_metadata_cover).';

drop index battle_metadata_cover;
