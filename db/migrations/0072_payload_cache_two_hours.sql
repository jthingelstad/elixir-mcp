-- The payload cache is two hours, not two days (2026-09-11, same day as 0071).
--
-- The first sweep under 0071 found only 5,256 of ~20,000 cached rows older
-- than 48 hours: the recorder refetches nearly every entity daily, so a
-- two-day window kept almost everything resident. The readers need less -
-- live_fetch reads the payload it just waited for, within seconds; the
-- card catalog reads its one 'cards' row, which is exempt. So: two hours,
-- swept hourly. And the partial index from 0071 goes: it made every
-- last_fetched_at update on this table non-HOT, to serve a query that
-- scans a 4 MB heap once an hour.

drop index if exists api_payload_cached;
comment on column api_payload.payload_json is
  'Cache of the S3 archive object for ~2 hours after the last fetch (the cards catalog row is kept); null once swept. The archive (payloads/ in the archive bucket) is the record.';
