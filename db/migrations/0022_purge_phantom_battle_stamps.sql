-- 0021 purged phantom seasons (>135, the runaway stateful clock) from the
-- war TABLES but left the stamps on battle rows — and stampWarKeys only
-- revisits season_id IS NULL rows, so those stamps were frozen wrong
-- forever. Same for (135,4) rows stamped before the section's day anchor
-- existed: season/section right, war_day null, never revisited.
--
-- Null them all back to unstamped: the stamper re-resolves anything
-- within its 14-day window from the battle's OWN time against the
-- calendar clock; older rows stay honestly null (phantom-null beats
-- phantom-wrong; the periodLogs harvest is the eventual deep fix).

update battle
set season_id = null, section_index = null, war_day = null
where season_id > 135
   or (season_id = 135 and section_index = 4 and war_day is null);
