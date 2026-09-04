-- Clan recordings get an explicit SCOPE (Jamie, 2026-09-04): 'activity'
-- records the clan itself (roster, war, standings, participation);
-- 'comprehensive' additionally records EVERY open member's battles and
-- profile, following membership as it changes — what elixir-bot will
-- need, and what POAP KINGS gets. The distinction is stamped at the
-- source (this column), never re-derived by readers.
--
-- Every existing clan recording was de-facto comprehensive (member
-- fan-out was unconditional), so the backfill preserves behavior.

alter table recording add column clan_scope text
  check (clan_scope in ('activity', 'comprehensive'));

update recording set clan_scope = 'comprehensive' where subject_type = 'clan';

-- Scope is exactly a clan concept: present on clans, absent on players.
alter table recording add constraint recording_scope_shape
  check ((subject_type = 'clan') = (clan_scope is not null));
