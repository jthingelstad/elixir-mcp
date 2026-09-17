-- 0125: the JSON columns leave (schema review 1.8, plan step 15; the
-- contract half of 0123 and 0124), one deploy after their readers moved
-- and the fills completed: the snapshot's three objects, the card's
-- icon map, the activity row's rhythm / days / not-recorded lists, the
-- receipt's error list (renamed into place), and the participant's
-- tower map once {tower_hp_backfill} had filled every row and
-- {event_payload_census} had rendered every event's facts from the
-- columns equal to the stored JSON. Column drops are instant and
-- rewrite nothing; the space returns as rows are rewritten and
-- autovacuum runs. What stays JSON, by decision: api_payload.payload_json
-- (the raw cache), mcp_call_audit.args, feedback.context,
-- account_event.detail, magic_login.context / started_from.
alter table player_snapshot_daily
  drop column lifetime,
  drop column pol,
  drop column league_stats;
alter table card drop column icon_urls;
alter table player_activity
  drop column rhythm,
  drop column days,
  drop column not_recorded_days;
alter table player_activity rename column rhythm_buckets to rhythm;
alter table player_activity rename column not_recorded to not_recorded_days;
alter table player_activity alter column rhythm set not null;
alter table player_activity alter column not_recorded_days set not null;
alter table api_receipt drop column admission_errors;
alter table api_receipt rename column admission_error_list to admission_errors;
alter table battle_participant drop column tower_hp;
alter table player_event drop column payload;
alter table clan_event drop column payload;
