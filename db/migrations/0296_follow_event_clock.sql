-- 0296: Give follower activity its own timestamp before retiring Watching.
-- Engineering, 2026-11-17. A claim can predate when a person follows.
-- Migrate runs before Lambda cutover: move every alert reader to this
-- timestamp in a separate release before importing any friend relationships.
-- claim held an estimated 122 rows on two heap pages at preflight.
-- The nullable column and small backfill share one bounded ALTER lock.
-- vacuum after: claim
set local lock_timeout = '5s';
set local statement_timeout = '20s';

alter table claim add column followed_at timestamptz;
update claim set followed_at = created_at where relationship = 'friend';

create function stamp_claim_follow() returns trigger language plpgsql as $$
begin
  if new.relationship <> 'friend' then
    new.followed_at := null;
  elsif tg_op = 'INSERT' then
    new.followed_at := new.created_at;
  elsif old.relationship <> 'friend' then
    new.followed_at := now();
  else
    new.followed_at := old.followed_at;
  end if;
  return new;
end;
$$;
create trigger claim_follow_stamp before insert or update on claim
  for each row execute function stamp_claim_follow();

comment on column claim.followed_at is
  '0296: time of the friend follow used by Notifications, mail and push. NULL means no follow event. claim.created_at remains the original date the player was added.';
