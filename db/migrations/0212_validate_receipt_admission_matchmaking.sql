-- 0212: validate 0211's widened admission check on api_receipt without the
-- drop-and-add lock. No row changes; inserts and updates continue during
-- the scan (0198 is the precedent on this table).
set local lock_timeout = '5s';
alter table api_receipt validate constraint api_receipt_admission_check;
