-- 0003: receipt idempotency for at-least-once delivery (DESIGN §5.1).
-- SQS redelivers; a redelivered result message must not mint a second
-- receipt. (gateway_id, endpoint, entity_key, fetched_at) is stable across
-- redeliveries and can never collide for genuinely distinct fetches — the
-- same gateway cannot fetch the same entity twice at the same instant.
create unique index api_receipt_idempotency
  on api_receipt (gateway_id, endpoint, entity_key, fetched_at);
