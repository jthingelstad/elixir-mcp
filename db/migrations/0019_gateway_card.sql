-- 0019: every gateway is a Clash Royale card (Jamie's fun, 2026-09-04).
-- Assigned lazily from the recorded catalog (deterministic on
-- gateway_id) the first time a ladder/panel read finds it null.
alter table gateway add column card_name text;
alter table gateway add column card_icon text;
