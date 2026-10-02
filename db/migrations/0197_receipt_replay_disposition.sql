-- 0197: explicit replay disposition for the reviewed right-sizing purge.
-- Additive, nullable, no backfill. Original admission and payload identity
-- remain an audit fact. A later manifest-bound operation retires replay or
-- points it at a verified retained-only body under a new content address.
set local lock_timeout = '2s';
alter table api_receipt
  add column replay_retired_at timestamptz,
  add column replay_payload_hash text,
  add constraint api_receipt_replay_hash check (
    replay_payload_hash is null or replay_payload_hash ~ '^[a-f0-9]{64}$'
  ) not valid,
  add constraint api_receipt_replay_exclusive check (
    replay_retired_at is null or replay_payload_hash is null
  ) not valid;
comment on column api_receipt.replay_retired_at is 'Explicit approved retention retirement. Never replay this receipt; original admission/hash remain an audit fact.';
comment on column api_receipt.replay_payload_hash is 'Verified retained-only replay identity. Original payload_hash is immutable admission evidence.';
