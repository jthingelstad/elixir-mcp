-- 0238: Index the call log by the account that made each call.
-- Settings lists an owner's agents (GET /api/me/principals), and for each
-- one counts its calls this week, its last call, and where and as what it
-- last connected. mcp_call_audit had no index led by account_id, so each of
-- those subqueries read the whole table once per agent: 132,340 rows, a
-- 48 MB heap (table census, 2026-11-09), and the principals read ran a
-- p50 of 1.35-5.3 s (web latency, 2026-11). This index lets each be a
-- short range from the top of the agent's own calls. Additive: no row and
-- no answer changes. Small enough to build in the ladder: 5.3 MB of index
-- in 41 ms on a scratch table of the same 132,340 rows and 48 MB, cached;
-- a cold read of the heap on the micro adds a second or two. SHARE lock:
-- reads continue, call-log inserts wait for the bounded build; fail fast
-- behind a conflicting writer.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index mcp_call_audit_by_account
  on mcp_call_audit (account_id, created_at desc);

comment on index mcp_call_audit_by_account is
  '0238: an agent''s calls, newest first, for the principal list.';
