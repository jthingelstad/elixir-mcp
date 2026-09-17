-- 0114: validate the rest of 0108/0109 (plan step 8). Scans under SHARE
-- UPDATE EXCLUSIVE over 165k, 36k, 9k, 2k, 1.3k and a few thousand
-- rows; {enum_census} counted 0 orphans on each before this was
-- written.
alter table player_card validate constraint player_card_card_fk;
alter table war_participation validate constraint war_participation_week_fk;
alter table war_attendance_day validate constraint war_attendance_day_week_fk;
alter table war_week_clan validate constraint war_week_clan_week_fk;
alter table ranking_snapshot validate constraint ranking_snapshot_season_fk;
alter table ranking_presence validate constraint ranking_presence_season_fk;
