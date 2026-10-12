-- 0224: validate 0223's widened check on feedback_ref without the
-- drop-and-add lock. No row changes; inserts continue during the scan
-- (0217 is the precedent).
set local lock_timeout = '5s';
alter table feedback_ref validate constraint feedback_ref_kind_check;
