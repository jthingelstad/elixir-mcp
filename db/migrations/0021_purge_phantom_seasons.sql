-- 0021: purge the phantom war seasons (incident 2026-09-04, found by
-- an agent playtest cross-checking member_weeks against the battle
-- log). Stateful season inference ran away when archive payloads
-- replayed against future logged state: nine real weeks (true seasons
-- 134-135) scattered copies across "seasons 136-144", and post-replay
-- live polls filed the current colosseum as "145". The calendar is now
-- the source of truth (war-clock seasonFromDate; verified against
-- riverracelog createdDate stamps): true current = season 135,
-- section 4. Real history (132-135) is untouched; the current week's
-- rows rebuild via MAX-merge within one poll cycle.
delete from war_attendance_day where season_id > 135;
delete from war_participation where season_id > 135;
delete from war_week_clan where season_id > 135;
delete from war_week where season_id > 135;
