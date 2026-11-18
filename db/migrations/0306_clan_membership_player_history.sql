-- Check an incoming roster against both open and closed membership intervals
-- for the named players. The open-only index cannot rule out a newer departure.
-- Production census: 596 live rows, 568 heap pages. A plain index build takes
-- the table's write lock only for this short migration.
set local lock_timeout = '5s';
set local statement_timeout = '15s';
create index clan_membership_player_history
  on clan_membership (player_tag, joined_observed_at desc);
