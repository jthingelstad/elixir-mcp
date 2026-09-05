-- Capture miss-rate audit (Jamie, 2026-09-06: "truly know if we have
-- gaps in data collection"). One row per FRESH battlelog poll of a
-- subject with prior coverage: gap=true means the payload's OLDEST
-- battle was previously unseen - the rotating ~30-battle log may have
-- rolled past battles we never captured. Aggregated on /data/status;
-- never blocks ingest.
create table capture_audit (
  receipt_id  bigint primary key references api_receipt,
  subject_tag text not null,
  gap         boolean not null,
  fetched_at  timestamptz not null
);
create index capture_audit_fetched on capture_audit (fetched_at);
