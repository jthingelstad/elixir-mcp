-- 0016: fleet-version visibility — gateways report their checkout SHA
-- on every result message; ingest stamps it with the heartbeat.
alter table gateway add column last_seen_sha text;
