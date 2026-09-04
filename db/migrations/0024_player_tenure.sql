-- Experience cohorts (META-INTEL, Jamie 2026-09-04): pilot_score embeds
-- experience, so tenure becomes first-class. Source: the YearsPlayed
-- badge on player profiles - level = completed years, progress = account
-- age in DAYS (verified live: level 4 / progress 1648 / target 1825).
-- ABSENT is unknown, never zero: verified absent on a 4+ year account
-- (Chanco) as well as sub-year accounts, exactly as cr-agent-api-docs
-- warns.

alter table player add column years_played integer;
alter table player add column account_age_days integer;

-- Backfill from the hot payload set (latest player payload per tag).
update player p
set years_played = (b.badge->>'level')::int,
    account_age_days = (b.badge->>'progress')::int
from api_payload ap
cross join lateral (
  select elem as badge from jsonb_array_elements(ap.payload_json->'badges') elem
  where elem->>'name' = 'YearsPlayed' limit 1
) b
where ap.endpoint = 'player' and ap.entity_key = p.player_tag;
