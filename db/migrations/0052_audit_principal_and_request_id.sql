-- An audited call must say WHICH credential made it, and a caller must be
-- able to name the row its call produced.
--
-- Today mcp_call_audit records account_id, plus surface as the string
-- 'svc:<name>'. That makes the principal visible to a human reading the
-- table and invisible to anything that joins — and every service token on
-- one account is one account. Worse, nothing the CALLER receives points at
-- a row: a screenshot of a wrong answer has no thread back to the server.
--
-- Pure expand. Both columns are nullable, existing rows stay valid, and
-- nothing reads them until the code that writes them ships behind this.
-- surface is deliberately left alone: things already read it.

alter table mcp_call_audit add column token_id bigint references service_token;
alter table mcp_call_audit add column request_id uuid;

-- Partial indexes: the columns are null for every row written before this
-- migration and for every OAuth call (no token), so indexing the nulls
-- would be indexing most of the table's history for nothing.
create index mcp_call_audit_by_request on mcp_call_audit (request_id)
  where request_id is not null;
create index mcp_call_audit_by_token on mcp_call_audit (token_id, created_at desc)
  where token_id is not null;

comment on column mcp_call_audit.token_id is
  'Which service token made the call; null for OAuth and for rows predating 0052.';
comment on column mcp_call_audit.request_id is
  'Returned to the caller as meta.request_id, so a reported answer joins to its row.';
