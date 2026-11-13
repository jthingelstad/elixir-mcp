-- 0261: Widen 0250's weekly snapshot cover with the profile battle counter.
-- clans_participation's capture estimate (captureByPlayer: the profile's
-- battle_count rise between profile reads against the battles recorded)
-- read profile_observed_at and battle_count from the wide snapshot heap,
-- where a member's day rows sit one to a page: about 700 pages from disk
-- for a 50-member clan's two weeks on a synthetic year, after the members'
-- donations already read index-only from 0250's cover. The acceptance
-- gate's clans_participation weeks 2 ran 8 to 10 s on its first call
-- after a deploy (2026-11-13). This index keeps 0250's key and columns,
-- adds the two the capture read needs, and replaces it; the old one is
-- dropped here.
-- Records and query semantics are unchanged; the primary key still owns
-- identity. Sized with {tables} 2026-11-13: about 20,000 live rows; the
-- index is about 1.5 MB. A profile read's update now always touches an
-- indexed column (profile_observed_at), so it is no longer HOT; with
-- trophies (0102) and donations (0250) indexed, most already were not.
-- The build takes a SHARE lock (reads continue, ingest waits seconds);
-- the drop takes ACCESS EXCLUSIVE for an instant at the end. Fail fast
-- behind a conflicting writer or reader; the deploy retries.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index player_snapshot_daily_week_cover
  on player_snapshot_daily (player_tag, snapshot_date)
  include (snapshot_kind, donations, clan_tag, profile_observed_at, battle_count);

comment on index player_snapshot_daily_week_cover is
  '0261: weekly donation high-water marks and the profile battle-counter capture estimate per member, index-only (replaces 0250 player_snapshot_daily_donations_cover).';

drop index player_snapshot_daily_donations_cover;
