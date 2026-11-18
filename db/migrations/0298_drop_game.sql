-- Admit each verified player's completed Drop game. Every prior kind still fits.
set local lock_timeout = '5s';
alter table attested_fact drop constraint attested_fact_fact_type_check;
alter table attested_fact add constraint attested_fact_fact_type_check check (
  fact_type in ('departure_classified','role_change_made','award_granted','member_away',
    'clan_message','personal_record','award_standing','drop_game')
) not valid;
