-- Validate separately so the check scans while writes continue.
set local lock_timeout = '5s';
alter table attested_fact validate constraint attested_fact_fact_type_check;
