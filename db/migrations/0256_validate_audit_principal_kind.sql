-- 0256: validate the principal kind check 0255 re-added NOT VALID.
--
-- Lock shapes take separate migrations (DECISIONS, Schema and
-- migrations): this scans mcp_call_audit under SHARE UPDATE EXCLUSIVE, so
-- no read or insert of an audit row waits. Every existing row passed the
-- narrower 0094 check, so it passes this one.

set local lock_timeout = '5s';

alter table mcp_call_audit validate constraint mcp_call_audit_principal_kind_check;
