-- 0180: award_standing joins the attested fact types.
--
-- Jamie, 2026-09-25: a clan's Discord agent should say where its season
-- awards stand before the season closes ("how will we relay awards status
-- mid week? I guess Clan can publish the standings each day to Elixir?").
-- The awards are Elixir Clan's (its rules, its names); the standing is a
-- fact the app computes, written on its integration key and labelled as
-- the app's, never a person's (contracts facts.ts, attesters ["app"]).
--
-- The fact_type check enumerates the types, so it is dropped and re-added
-- NOT VALID with award_standing (every existing row still matches) and
-- validated in 0181. The table is small; lock_timeout bounds the brief
-- ACCESS EXCLUSIVE.

set local lock_timeout = '5s';

alter table attested_fact drop constraint attested_fact_fact_type_check;
alter table attested_fact add constraint attested_fact_fact_type_check check (
  fact_type in (
    'departure_classified', 'role_change_made', 'award_granted',
    'member_away', 'clan_message', 'personal_record', 'award_standing')
) not valid;
