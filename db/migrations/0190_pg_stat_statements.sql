-- 0190: pg_stat_statements, so the next instance and storage decisions
-- read measured statements (2026-09-27).
--
-- The db.t4g.medium trigger, a result cache, card_keys on the population
-- table and the invoker's fixed cost all wait on knowing which
-- statements spend the time and the reads (review 2026-09-27 §5.3 and
-- lane D, issue #71). RDS preloads the library in the default
-- shared_preload_libraries (checked on elixir-mcp-enc, PostgreSQL 17.9);
-- the extension only has to exist in the database. It is free, and not
-- Performance Insights, which DECISIONS declines.
--
-- Read through the {statements} migrate op: the top statements by total
-- execution time and by shared blocks read, normalized text only (the
-- view never holds parameter values). The migrate user is the master
-- user (rds_superuser), which may create it.
--
-- Takes no lock on any table; the view and its functions land in public.

create extension if not exists pg_stat_statements;
