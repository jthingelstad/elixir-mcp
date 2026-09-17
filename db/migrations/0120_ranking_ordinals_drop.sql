-- 0120: the contract half of 0109. ranking_snapshot and ranking_presence
-- key their season on season_month (validated in 0114); nothing has
-- named the text ordinal since the readers moved a deploy ago. The
-- presence key rebuilds over a few thousand rows.
alter table ranking_snapshot drop column season_id;
alter table ranking_presence drop constraint ranking_presence_pkey;
alter table ranking_presence add primary key (player_tag, board, location_key, season_month);
alter table ranking_presence drop column season_id;
