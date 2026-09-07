-- 0048: repair the S135 -> S136 stand-by window (2026-09-07, 09:30-09:44Z).
--
-- The season calendar dated seasons from 09:30Z while periods use the
-- 10:00Z policy hour (fixed in war-clock.mjs the same day, from the game's
-- own countdown: 24m46s left at 09:35:14Z = 10:00:00Z). Clash Royale ends
-- the RACE ~09:30 and rolls the SEASON at 10:00, and in that stand-by
-- half hour currentriverrace still describes the finished race. Live
-- payloads carry no seasonId, so the calendar decided -- and for 14
-- minutes it stamped S135's colosseum (section 4) as season 136: the
-- phantom-season shape migration 0021 purged, one section wide.
--
-- Deleting the phantom alone would LOSE data: it holds the final 38,700
-- boat fame while the real (135, 4) row froze at 38,400. So MAX-merge it
-- home first -- the same semantics the ingest itself uses -- then delete.
--
-- Guarded to (136, section 4), which can never be real: S136 runs
-- 2026-09-07 -> 2026-10-05, four sections, 0..3.

insert into war_week (clan_tag, season_id, section_index, is_colosseum,
                      started_observed_at, finished_observed_at)
select clan_tag, 135, 4, is_colosseum, started_observed_at, finished_observed_at
  from war_week where season_id = 136 and section_index = 4
on conflict (clan_tag, season_id, section_index) do update set
  is_colosseum = war_week.is_colosseum or excluded.is_colosseum,
  started_observed_at = least(war_week.started_observed_at,
                              excluded.started_observed_at),
  finished_observed_at = greatest(war_week.finished_observed_at,
                                  excluded.finished_observed_at);

insert into war_week_clan (clan_tag, season_id, section_index,
                           participant_clan_tag, participant_name, fame,
                           finish_time)
select clan_tag, 135, 4, participant_clan_tag, participant_name, fame,
       finish_time
  from war_week_clan where season_id = 136 and section_index = 4
on conflict (clan_tag, season_id, section_index, participant_clan_tag)
do update set
  participant_name = coalesce(excluded.participant_name,
                              war_week_clan.participant_name),
  fame = greatest(war_week_clan.fame, excluded.fame),
  finish_time = coalesce(war_week_clan.finish_time, excluded.finish_time);

insert into war_participation (clan_tag, season_id, section_index, player_tag,
                               points, decks_used, boat_attacks)
select clan_tag, 135, 4, player_tag, points, decks_used, boat_attacks
  from war_participation where season_id = 136 and section_index = 4
on conflict (clan_tag, season_id, section_index, player_tag) do update set
  points = greatest(war_participation.points, excluded.points),
  decks_used = greatest(war_participation.decks_used, excluded.decks_used),
  boat_attacks = greatest(war_participation.boat_attacks,
                          excluded.boat_attacks);

insert into war_attendance_day (clan_tag, season_id, section_index, war_day,
                                player_tag, decks_used_today, finalized)
select clan_tag, 135, 4, war_day, player_tag, decks_used_today, finalized
  from war_attendance_day where season_id = 136 and section_index = 4
on conflict (clan_tag, season_id, section_index, war_day, player_tag)
do update set
  decks_used_today = greatest(war_attendance_day.decks_used_today,
                              excluded.decks_used_today),
  finalized = war_attendance_day.finalized or excluded.finalized;

delete from war_attendance_day where season_id = 136 and section_index = 4;
delete from war_participation  where season_id = 136 and section_index = 4;
delete from war_week_clan      where season_id = 136 and section_index = 4;
delete from war_week           where season_id = 136 and section_index = 4;

-- Battle war keys are COALESCE-fill only, so a wrong stamp never self-heals.
update battle set season_id = 135 where season_id = 136 and section_index = 4;
