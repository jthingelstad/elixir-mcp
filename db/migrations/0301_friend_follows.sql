-- 0301: Retire Watching in place after the follow-event clock is live.
-- Jamie, 2026-11-17: Watching becomes Friend. Slots, recordings, notify,
-- claim creation dates, nicknames and prior real follow events stay intact.
-- Converted relationships create no events, account links or deliveries.
-- DISABLE TRIGGER takes a write-excluding table lock for this transaction;
-- the trigger is restored before commit. The clock preparation is 0296.
-- claim held an estimated 122 rows on two heap pages at live preflight.
-- vacuum after: claim
set local lock_timeout = '5s';
set local statement_timeout = '20s';

alter table claim disable trigger claim_follow_stamp;
update claim set relationship = 'friend' where relationship = 'watching';
alter table claim enable trigger claim_follow_stamp;

alter table claim alter column relationship set default 'friend';
alter table claim drop constraint claim_relationship_check;
alter table claim add constraint claim_relationship_check
  check (relationship in ('primary', 'alt', 'friend')) not valid;

comment on column claim.relationship is
  '0301: primary | alt | friend. A friend is any other player followed; one primary per account, with one shared player-slot pool.';
