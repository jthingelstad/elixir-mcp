-- ADDED = RECORDED (Jamie, 2026-09-05): there is no add-without-record
-- state and no separate "watch" toggle. Adding a player or clan starts
-- collection within your tier's slots; the ONLY per-subject setting is
-- whether it feeds your notification pipe. clan_follow (a do-nothing
-- bookmark, one day old) dies; account_clan is the real association -
-- a clan you ADDED, with your requested scope and notify preference.

drop table clan_follow;

create table account_clan (
  account_id uuid not null references account on delete cascade,
  clan_tag   text not null,
  scope      text not null default 'comprehensive'
             check (scope in ('activity', 'comprehensive')),
  notify     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (account_id, clan_tag)
);

-- Players: the claim IS the association; it gains the notify setting.
alter table claim add column notify boolean not null default true;

-- Backfill: every active clan recording someone requested is that
-- account's added clan.
insert into account_clan (account_id, clan_tag, scope)
select requested_by, subject_tag, coalesce(clan_scope, 'comprehensive')
from recording
where subject_type = 'clan' and status = 'active'
  and requested_by is not null
on conflict do nothing;
