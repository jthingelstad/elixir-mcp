-- 0155: the database's own default session time zone is UTC.
--
-- The record is UTC everywhere (AGENTS.md: "Store UTC everywhere;
-- timezone is a display concern"). The day keys are UTC too
-- (battle_time.slice(0,10) off the ISO string). But a plain `::date`,
-- `current_date` or `date_trunc('week', ts)` over a timestamptz resolves
-- in the SESSION zone. 2026-09-23 counted 68 such expressions outside
-- rollups.mjs and daily-sql.mjs, spread over 98 places that open their own
-- pg.Client. Production reads UTC only because the RDS parameter group
-- defaults to it. A developer machine on America/Chicago made the
-- clans_standings test go red for the five hours after UTC midnight,
-- and it read as a live bug (NOTES 2026-09-23, "the clock-edge was the
-- environment").
--
-- Pinning the zone at the database, not in every client, covers all of
-- them at once: Lambdas, ops, scratch test databases (migrated before
-- their test client connects) and anyone's psql. node-pg does not read
-- PGTZ, so the environment cannot do this. A session that sets its own
-- zone (the Kiritimati test in rollups) still overrides it. The setting
-- takes effect on the NEXT connection, never the current one.
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'UTC');
end
$$;
