-- The raw payload archive lives in S3; Postgres keeps only the last two
-- days of it (2026-09-11).
--
-- api_payload.payload_json duplicated the S3 archive row for row: every
-- admitted payload is put to S3 in the same transaction (pipeline.mjs),
-- and the weekly sweep removed only SUPERSEDED rows, so the latest
-- payload of every entity stayed in Postgres forever - 400 MB of TOAST,
-- 41% of the database, on a 1 GB instance that swapped itself into an
-- unplanned recovery this morning. Two readers want the JSON, and both
-- want it within seconds of admission: live_fetch (the payload it just
-- waited for) and the card catalog (fetched daily). So the column stays,
-- as a cache: nullable, restored by any refetch of the same content, and
-- nulled by the daily sweep once the row is two days old and its S3
-- twin HEAD-verifies. Replay reads S3.

alter table api_payload alter column payload_json drop not null;
comment on column api_payload.payload_json is
  'Cache of the S3 archive object for ~48 hours after the last fetch; null once swept. The archive (payloads/ in the archive bucket) is the record.';

-- The sweep's second phase reads by age and presence.
create index api_payload_cached on api_payload (last_fetched_at)
  where payload_json is not null;
