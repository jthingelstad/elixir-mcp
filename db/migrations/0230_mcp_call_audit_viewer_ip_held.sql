-- 0230: Index the call-log rows that still hold an address.
-- The hourly operational sweep clears viewer_ip from calls older than 30
-- days. With nothing narrower than mcp_call_audit_by_time it walked every
-- row older than the cut each hour, long since cleared, to find the one
-- hour that still held an address: 108 runs over a second in the week to
-- 2026-10-21 (Postgres slow log, p50 1.6 s; platform review §3).
-- A partial index holds only the rows with an address, about the last 30
-- days, so the sweep reads the rows it clears and no others. Additive: no
-- row and no read changes. SHARE lock: reads continue, call-log inserts
-- wait for the bounded build; fail fast behind a conflicting writer.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index mcp_call_audit_viewer_ip_held on mcp_call_audit (created_at)
  where viewer_ip is not null;

comment on index mcp_call_audit_viewer_ip_held is
  '0230: the 30-day address scrub reads only the rows that still hold an address.';
