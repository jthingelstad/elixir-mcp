-- 0002: account timezone (Jamie, 2026-09-03) — DESIGN §3.
-- IANA zone name, set in the web UI; NULL means UTC. Storage stays UTC
-- everywhere; this only drives tool-layer rendering and relative-window
-- resolution. Validated at the app layer (Intl supported zones).
alter table account add column timezone text;
