-- 0217: validate 0216's widened checks on feedback and feedback_ref
-- without the drop-and-add lock. No row changes; inserts and updates
-- continue during the scan (0212 is the precedent).
set local lock_timeout = '5s';
alter table feedback validate constraint feedback_status_check;
alter table feedback_ref validate constraint feedback_ref_kind_check;
