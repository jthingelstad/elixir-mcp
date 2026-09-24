-- 0170: the contract half of 0169. Nothing reads or writes
-- war_training_day since 7.1.17; any row the old ingest wrote during that
-- deploy's flip window is carried over first, then the table goes.

set local lock_timeout = '5s';

insert into war_attendance_day
  (clan_tag, season_id, section_index, day_in_section, player_tag,
   decks_used_today, source)
select clan_tag, season_id, section_index, training_day - 1, player_tag,
       decks_used_today, source
  from war_training_day
on conflict (clan_tag, season_id, section_index, day_in_section, player_tag)
do update set decks_used_today = greatest(war_attendance_day.decks_used_today,
                                          excluded.decks_used_today);

drop table war_training_day;
