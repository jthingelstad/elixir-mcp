-- 0181: validate the fact_type check 0180 re-added NOT VALID.
--
-- Lock shapes take separate migrations (DECISIONS, Schema and
-- migrations): 0180 added the check without scanning; this scans it
-- under SHARE UPDATE EXCLUSIVE, so no read or write of a fact waits.

set local lock_timeout = '5s';

alter table attested_fact validate constraint attested_fact_fact_type_check;
