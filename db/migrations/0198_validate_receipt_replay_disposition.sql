-- 0198: validate nullable replay constraints without the column-add lock.
-- No row changes; ordinary inserts/updates can continue during the scan.
set local lock_timeout = '2s';
alter table api_receipt validate constraint api_receipt_replay_hash;
alter table api_receipt validate constraint api_receipt_replay_exclusive;
