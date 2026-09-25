-- 0177: the elixir-bot import's staging schema goes.
--
-- {series_import} (Phase 3, 2026-09-18) created schema staging at run
-- time, outside the migration ladder, to hold the bot's series beside the
-- record while {series_census} compared them; the commit carried the
-- rows the record lacked into the public tables and nothing has read
-- staging since. Both ops were removed on 2026-09-25. The schema fingerprint
-- covers public only, and a fresh install never had staging, so this is a
-- no-op there and changes no pin.

drop schema if exists staging cascade;
