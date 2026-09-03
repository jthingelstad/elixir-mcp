-- 0009: per-account MCP quota override (NULL = service default, 500/day).
-- Adjusting one account is a row update, never a deploy. Usage itself is
-- read from mcp_call_audit + rate_limit; no new counters.
alter table account add column mcp_daily_quota integer;
