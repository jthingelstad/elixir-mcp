-- One entitlements system (Jamie, 2026-09-05): the ladder gains its
-- top rung. role='owner' is the super admin - exactly one, whom no
-- admin can demote or affect; role='admin' sees the console with
-- day-to-day powers (contracts consoleAccess/canSetRole are the
-- single source). is_owner stays as a legacy column but gating now
-- reads the role.

alter table account drop constraint account_role_check;
alter table account add constraint account_role_check
  check (role in ('member', 'leader', 'family', 'partner', 'admin', 'owner'));

update account set role = 'owner' where is_owner;

-- Add-vs-watch separation (same session): following a clan is an
-- association; WATCHING it (recording) is a separate, role-slotted
-- act with a toggle. Player claims already work this way.
create table clan_follow (
  account_id uuid not null references account on delete cascade,
  clan_tag   text not null,
  created_at timestamptz not null default now(),
  primary key (account_id, clan_tag)
);

-- Clan watching is PURELY a user function now (Jamie: "removed
-- entirely from admin"): existing watches surface on the user's own
-- Your-clans panel, so their holders must follow what they watch.
insert into clan_follow (account_id, clan_tag)
select requested_by, subject_tag from recording
where subject_type = 'clan' and status = 'active'
  and requested_by is not null
on conflict do nothing;
