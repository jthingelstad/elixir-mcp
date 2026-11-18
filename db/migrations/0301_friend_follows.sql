-- 0301: Retire Watching in place after the follow-event clock is live.
-- Jamie, 2026-11-17: Watching becomes Friend. Slots, recordings, notify,
-- claim creation dates, nicknames and prior real follow events stay intact.
-- Converted relationships create no events, account links or deliveries.
-- DISABLE TRIGGER takes a write-excluding table lock for this transaction;
-- the trigger is restored before commit. The clock preparation is 0296.
-- claim held an estimated 122 rows on two heap pages at live preflight.
-- Codex review #1148, 2026-11-18: this file has not shipped. Install the
-- old-writer normalizer in the same transaction as the narrower check.
-- It remains until old Lambda revisions can no longer be invoked.
-- vacuum after: claim
set local lock_timeout = '5s';
set local statement_timeout = '20s';

alter table claim disable trigger claim_follow_stamp;
update claim set relationship = 'friend' where relationship = 'watching';
alter table claim enable trigger claim_follow_stamp;

create function normalize_legacy_watching_claim() returns trigger
language plpgsql as $$
begin
  if new.relationship = 'watching' then
    new.relationship := 'friend';
  end if;
  return new;
end;
$$;

-- PostgreSQL runs same-kind triggers by name: claim_follow_stamp must
-- first see Watching and clear followed_at, then this normalizes the
-- relationship. Old add/demote writes must not invent follow activity.
create trigger claim_watching_compat before insert or update on claim
for each row execute function normalize_legacy_watching_claim();

comment on trigger claim_watching_compat on claim is
  '0301: normalize legacy Watching writes after the follow clock clears their event time; retain through the old Lambda invocation window.';

alter table claim alter column relationship set default 'friend';
alter table claim drop constraint claim_relationship_check;
alter table claim add constraint claim_relationship_check
  check (relationship in ('primary', 'alt', 'friend')) not valid;

comment on column claim.relationship is
  '0301: primary | alt | friend. A friend is any other player followed; one primary per account, with one shared player-slot pool.';
