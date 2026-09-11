-- What the collector saw and dropped under the lease's filter (2026-09-11).
--
-- A battlelog lease now carries the observer's high-water mark, and the
-- collector submits the API's array minus everything at or before it,
-- with two counts beside fetched_at: observed (entries before the
-- filter) and filtered (entries dropped). Ingest used them for the
-- capture audit but kept nothing, so "29 observed, 5 new" was invisible
-- a second later. On the receipt they are the record of what the poll
-- actually found: null on receipts from collectors that did not filter.

alter table api_receipt add column observed integer;
alter table api_receipt add column filtered integer;
comment on column api_receipt.observed is
  'Entries the collector saw before applying the lease''s filter; null when it did not filter.';
comment on column api_receipt.filtered is
  'Entries the collector dropped under the lease''s filter (already held by the hub); new = observed - filtered.';
