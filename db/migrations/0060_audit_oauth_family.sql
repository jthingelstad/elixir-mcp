-- Which CONNECTION made a call, not merely which client name.
--
-- 0059 recorded client_name so several agents on one account stopped looking
-- identical. For the personal door the unit is different: a person connects
-- Claude, then an editor, then Claude again after re-consent, and each of
-- those is an oauth_family - the thing they can actually revoke. Matching a
-- call back to it by display name would merge two clients that chose the same
-- name, which is the class of quietly-wrong this codebase keeps out.
alter table mcp_call_audit add column oauth_family_id uuid references oauth_family;

create index mcp_call_audit_by_family
  on mcp_call_audit (oauth_family_id, created_at desc)
  where oauth_family_id is not null;

comment on column mcp_call_audit.oauth_family_id is
  'The consent grant this call was made under. Null for service tokens, which are identified by token_id.';
