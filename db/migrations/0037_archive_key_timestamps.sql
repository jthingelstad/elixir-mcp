-- 0037: archive-key timestamp repair (sol-6 finding 6, 2026-09-05).
--
-- Admission archives new payload content to S3 under a key built from
-- the COLLECTOR's fetched_at, but this table's first_fetched_at
-- defaulted to ingest now() - so the weekly sweep, which reconstructs
-- the key from first_fetched_at, could never find the twin for any
-- admission-archived row and retained them all (safe, but the hot-set
-- cleanup silently stopped working). The pipeline now stamps
-- first_fetched_at from the message; this backfills the drifted rows.
--
-- Scope: ONLY rows created after archive-at-admission shipped
-- (2026-09-04 ~16:00Z first live object). Older rows were archived by
-- the export path, whose S3 keys were built FROM first_fetched_at -
-- rewriting those would orphan their existing twins.

update api_payload p
set first_fetched_at = r.min_fetched
from (
  select endpoint, entity_key, payload_hash, min(fetched_at) as min_fetched
  from api_receipt
  group by endpoint, entity_key, payload_hash
) r
where r.endpoint = p.endpoint
  and r.entity_key = p.entity_key
  and r.payload_hash = p.payload_hash
  and p.first_fetched_at >= '2026-09-04T16:00:00Z'
  and r.min_fetched < p.first_fetched_at;
