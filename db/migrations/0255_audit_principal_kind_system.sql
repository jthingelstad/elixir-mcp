-- 0255: a tool call's audit row may name the system as its principal.
--
-- Elixir Clan's morning run reads through the audited invoker as Elixir
-- itself, with no account and no integration ("No integrations: Elixir
-- has users and agents", Jamie, 2026-11-13). Its rows are written with
-- account_id null and principal_kind 'system'. 0094 allowed person, agent
-- and integration. 'integration' stays allowed until the integration keys
-- are removed in their own JSON API major.
--
-- Replacing a CHECK is a drop and an add NOT VALID in one file (no scan
-- under the ACCESS EXCLUSIVE lock); 0256 validates in its own migration.
-- The code serving during the flip never writes 'system', so it passes
-- both shapes. lock_timeout bounds the brief lock behind the insert path.

set local lock_timeout = '5s';

alter table mcp_call_audit drop constraint mcp_call_audit_principal_kind_check;
alter table mcp_call_audit add constraint mcp_call_audit_principal_kind_check
  check (principal_kind is null
         or principal_kind in ('person', 'agent', 'integration', 'system'))
  not valid;

comment on column mcp_call_audit.principal_kind is
  'Who made the call: person, agent or integration (a connection''s kind), or system for Elixir acting for itself with no account (0255: Elixir Clan''s morning run). Null before 0063.';
