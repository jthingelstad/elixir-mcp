-- 0202: bounded agent policy context grants (Jamie, 2026-10-04).
-- Explicit approval, never inferred from game scopes or recording association.
-- Only new empty storage; no grants or policy values are seeded. Tiny account
-- relations gain revocation triggers with a bounded lock wait. Canonical game
-- records and private policy storage remain unchanged.
set local lock_timeout = '5s';

create table agent_policy_context_grant (
  grant_id uuid primary key default gen_random_uuid(),
  agent_account_id uuid not null references account(account_id) on delete cascade,
  owner_account_id uuid not null references account(account_id) on delete cascade,
  clan_tag text not null references clan(clan_tag),
  token_id bigint not null references service_token(token_id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text
);
create unique index agent_policy_context_grant_active
  on agent_policy_context_grant(agent_account_id) where revoked_at is null;
comment on table agent_policy_context_grant is 'Explicit eight-field private policy context permission, bound to one agent, actual owner, clan and service credential (0202). Eligibility is checked on every read; no default grant.';
comment on column agent_policy_context_grant.revoked_at is 'Null while explicitly granted. Revocation is durable; ownership or primary assignment changes revoke rather than transfer permission.';

create function revoke_agent_policy_context_binding() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'account' then
    if old.owned_by_account_id is distinct from new.owned_by_account_id
       or old.kind is distinct from new.kind then
      update agent_policy_context_grant set revoked_at = now(), revoke_reason = 'ownership_changed'
        where agent_account_id = old.account_id and revoked_at is null;
    end if;
  elsif tg_table_name = 'service_token' then
    if old.account_id is distinct from new.account_id
       or new.revoked_at is not null or new.audience <> 'mcp' then
      update agent_policy_context_grant set revoked_at = now(), revoke_reason = 'credential_changed'
        where token_id = old.token_id and revoked_at is null;
    end if;
  elsif old.is_primary and (tg_op = 'DELETE' or not new.is_primary
         or old.account_id is distinct from new.account_id
         or old.clan_tag is distinct from new.clan_tag) then
    update agent_policy_context_grant set revoked_at = now(), revoke_reason = 'assignment_changed'
      where agent_account_id = old.account_id and revoked_at is null;
  end if;
  return null;
end $$;
create trigger agent_policy_context_owner_change after update of owned_by_account_id, kind on account
  for each row execute function revoke_agent_policy_context_binding();
create trigger agent_policy_context_assignment_change after update or delete on account_clan
  for each row execute function revoke_agent_policy_context_binding();
create trigger agent_policy_context_credential_change after update of account_id, revoked_at, audience on service_token
  for each row execute function revoke_agent_policy_context_binding();
