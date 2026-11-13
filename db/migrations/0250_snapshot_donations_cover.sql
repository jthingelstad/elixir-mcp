-- 0250: Cover the weekly donation reads on player_snapshot_daily (#649).
-- clans_participation reads each member's donation high-water mark per
-- ISO week, one primary key range per member (DONATIONS_BY_MEMBER). Day
-- rows are written day by day for every recorded player, so a member's
-- weeks sit one row to a heap page: about 2,650 pages read from disk for
-- one clan's eight weeks (explain_participation, 2026-11-13), the larger
-- part of Clan's 2 to 5 s cold page. This index carries what that read
-- needs, so the read is index-only on all-visible pages.
-- Records and query semantics are unchanged; the primary key still owns
-- identity. Sized with {tables} 2026-11-13: about 20,000 live rows over
-- 73 MB of heap; the index is about 1 MB. Updates that change donations
-- are no longer HOT (trophies already are not, through 0102's index).
-- The build takes a SHARE lock (reads continue, ingest waits seconds).
-- Fail fast behind a conflicting writer or reader; the deploy retries.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index player_snapshot_daily_donations_cover
  on player_snapshot_daily (player_tag, snapshot_date)
  include (snapshot_kind, donations, clan_tag);

comment on index player_snapshot_daily_donations_cover is
  '0250: weekly donation high-water marks per member index-only, without reading the wide snapshot heap.';
