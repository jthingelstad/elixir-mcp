-- 0299: Validate the relationship check separately from the conversion.
set local lock_timeout = '5s';
set local statement_timeout = '20s';
alter table claim validate constraint claim_relationship_check;
