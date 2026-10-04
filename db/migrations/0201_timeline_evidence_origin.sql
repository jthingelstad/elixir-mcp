-- 0201: stable moment origins and evidence attachment observations.
-- Jamie approved read-only Timeline evidence, 2026-10-04.
-- Nullable expansion: existing event rows resolve their original logical
-- moment at read time; a later evidence attachment freezes that origin.
-- No historical payload rewrite or new battle copy.
set local lock_timeout = '2s';
alter table player_event
  add column origin_event_id bigint,
  add column evidence_version integer,
  add column evidence_observed_at timestamptz;

comment on column player_event.origin_event_id is 'Original logical moment, independent of later crossing evidence. NULL uses the legacy first matching event. Writers maintain this canonical event reference; no historical scan or copied payload.';
comment on column player_event.evidence_version is 'Evidence attachment revision; NULL is the original observation (1).';
comment on column player_event.evidence_observed_at is 'When this evidence was observed; NULL uses the original observation window end.';
