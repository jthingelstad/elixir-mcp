-- What a fetch was worth (review §9.3 / §10, 2026-09-11): three nullable
-- columns on the receipt so the fleet pages can show yield and edge
-- filtering instead of fetch counts, and so points can reward only a
-- fetch that returned data (Jamie: "do not call back to reward a fetch
-- that resulted in no data"). Forward-only; nothing is backfilled.

alter table api_receipt add column api_bytes integer;
alter table api_receipt add column new_facts integer;
alter table api_receipt add column ingest_ms integer;
comment on column api_receipt.api_bytes is
  'Raw response bytes the collector read from the CR API before any filter; null from a collector that does not report it.';
comment on column api_receipt.new_facts is
  'Rows the projection inserted or changed - battles, membership events, moved snapshots, changed cards; 0 means the fetch repeated what was held.';
comment on column api_receipt.ingest_ms is
  'Wall time of the admission-and-projection transaction for this receipt.';
