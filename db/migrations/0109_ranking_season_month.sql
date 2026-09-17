-- 0109: the ranking tables key their season on the API's month (schema
-- review 1.5, plan step 9; expand half). ranking_snapshot.season_id is a
-- text copy of the war ordinal, ordered with ::int in one reader; the
-- finals have carried season_month since 0070 and the live boards take
-- the season their observed_at falls in. 1,266 snapshot rows; presence
-- is the recording reason per (player, board, season) and gets the same
-- column, filled from its ordinal. Readers move with this deploy; the
-- ordinals drop in 0115 once nothing names them.
update ranking_snapshot rs
   set season_month = s.season_month
  from season s
 where rs.season_month is null
   and s.starts_at <= rs.observed_at and s.ends_at > rs.observed_at;
alter table ranking_snapshot alter column season_month set not null;
alter table ranking_snapshot
  add constraint ranking_snapshot_season_fk
  foreign key (season_month) references season (season_month) not valid;
create index ranking_snapshot_season on ranking_snapshot (board, location_key, season_month, observed_at desc);
drop index ranking_snapshot_final_month;

alter table ranking_presence add column season_month text;
update ranking_presence rp
   set season_month = s.season_month
  from season s
 where s.war_season_id::text = rp.season_id;
alter table ranking_presence alter column season_month set not null;
alter table ranking_presence
  add constraint ranking_presence_season_fk
  foreign key (season_month) references season (season_month) not valid;
