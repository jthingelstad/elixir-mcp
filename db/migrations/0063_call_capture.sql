-- 0063: capture the payloads (docs/REVIEW-2026-09-10-DOCS-TOOLS-SEAM.md,
-- Part 5). Additive, nullable; NULL means "not measured" and every
-- reader of mcp_call_audit behaves exactly as before. The bodies
-- themselves do NOT live here: the archive bucket holds
-- calls/dt=<date>/request_id=<id>.json.gz and this row is the hot
-- pointer, the same split the payload archive already uses. The
-- bounded `args` column stays as the hot copy the census reads.
--
--   captured       true once the request/response body landed in S3.
--                  A failed write logs call_capture_failed and leaves
--                  this false; the 90-day expiry flips it back.
--   db_ms          sum of query wall time on the tool's connection.
--                  One client is one connection and pg serialises it,
--                  so the sum is exact, not an estimate.
--   db_queries     how many queries that was.
--   live_wait_ms   time blocked waiting on a collector in the live lane.
--                  NULL when the call never asked for a live fetch.
--   serialize_ms   JSON.stringify of the body: how much of the wall
--                  time was the answer's size rather than its work.
--   cold_start     the first invocation of a Lambda sandbox, which
--                  explains the latency outliers (review 4.2).
--   principal_kind person / agent / integration, so the census can
--                  split the three without a join.
--   on_behalf_of   the delegated id as the caller gave it (bounded to
--                  200 chars), to count delegated calls.
--   rpc_error_code a JSON-RPC-layer refusal that never reached the
--                  invoker and so never audited before: -32602 unknown
--                  tool, -32601 hidden tool, -32029 daily quota,
--                  -32003 scope. error_code stays NULL on those rows.
alter table mcp_call_audit add column captured boolean not null default false;
alter table mcp_call_audit add column db_ms integer;
alter table mcp_call_audit add column db_queries integer;
alter table mcp_call_audit add column live_wait_ms integer;
alter table mcp_call_audit add column serialize_ms integer;
alter table mcp_call_audit add column cold_start boolean;
alter table mcp_call_audit add column principal_kind text;
alter table mcp_call_audit add column on_behalf_of text;
alter table mcp_call_audit add column rpc_error_code integer;

comment on column mcp_call_audit.captured is
  'True once the request/response body landed in the archive bucket at calls/dt=<date>/request_id=<id>.json.gz. Flipped back to false after 90 days.';
comment on column mcp_call_audit.db_ms is
  'Sum of query wall time on the tool''s connection, in ms. Exact: one client is one serialised connection.';
comment on column mcp_call_audit.db_queries is
  'Number of queries the tool ran on its connection.';
comment on column mcp_call_audit.live_wait_ms is
  'Time blocked waiting on a collector in the live lane, in ms. NULL when no live fetch was made.';
comment on column mcp_call_audit.serialize_ms is
  'JSON.stringify of the response body, in ms.';
comment on column mcp_call_audit.cold_start is
  'True on the first invocation of a Lambda sandbox.';
comment on column mcp_call_audit.principal_kind is
  'person, agent or integration: what kind of principal made the call.';
comment on column mcp_call_audit.on_behalf_of is
  'The delegated id as the caller passed it (on_behalf_of, or segment.on_behalf_of), bounded to 200 chars.';
comment on column mcp_call_audit.rpc_error_code is
  'JSON-RPC-layer refusal code for rows that never reached a tool: -32602 unknown tool, -32601 hidden tool, -32029 daily quota, -32003 scope.';
