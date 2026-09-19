-- 0142: a collector that stops checking in is said so, once (2026-09-19).
-- Quarantine notified the owner and silence did not: Hog Rider had been
-- quiet for forty hours while elixir_collectors said "active". The hourly
-- sweep stamps this when it tells the owner; a later heartbeat makes the
-- next silence news again.
alter table gateway add column silent_notified_at timestamptz;
