-- 0300: comments on recorded Timeline items, including unclaimed players
-- and Clan activity (Jamie, 2026-11-18). Account events/posts keep their
-- account owner; game comments follow the player's current verified owner.
-- Null subject_tag means a clan-only item; null owner means no verified
-- player owner. Permissions remain separate from notification routing.
--
-- Read-only production census: timeline_comment 4 live rows, 0 dead,
-- one 8192-byte heap page, 122880 bytes total; attested_fact 96 rows,
-- 128 KiB total; timeline_cheer 69 rows, 64 KiB total (2026-11-18).
-- Constant defaults and dropping NOT NULL are
-- catalog-only, with a 5s lock timeout. The bounded classification changes
-- no comment IDs, words, dates, status or settings, and creates no activity.
-- Historical writers only admitted canonical posts or player-owned game
-- items. Exact attested_fact story hashes identify their restricted source;
-- ordinary game, player-visible personal records, Drop games and post receipts remain
-- eligible. Canonical type, not stale stored visibility, decides the audience.
-- The trigger also guards
-- old Lambda writes between migration and cutover. People and private Clan
-- comments receive no new owner notification; the new writer stamps that.
-- Restricted Clan and followers-only Drop cheers keep their reaction and
-- timestamps, without a delivery tag. Drop comment receipts are in-app.
-- vacuum after: timeline_comment, timeline_cheer

set local lock_timeout = '5s';

alter table timeline_comment
  alter column subject_tag drop not null,
  alter column owner_account_id drop not null,
  add column owner_is_account boolean not null default false,
  add column receipt_allowed boolean not null default true;

comment on table timeline_comment is
  'A person''s short moderated comment on a recorded Timeline item they may read (0300). Its source reader preserves the item''s original audience.';
comment on column timeline_comment.subject_tag is
  '0300: the player the item is about; null for clan-only activity. For game comments, its current verified owner may remove prior comments, including those posted before verification.';
comment on column timeline_comment.owner_account_id is
  '0300: canonical account owner for posts/people; game owner when posted, or null for an unclaimed player/clan-only item. Game moderation uses the current verified claim, not this historical stamp.';
comment on column timeline_comment.owner_is_account is
  '0300: true for canonical post or people-account ownership, false for current-player game ownership. Historical posts are classified by canonical item ID; old writers are normalized by trigger.';
comment on column timeline_comment.receipt_allowed is
  '0300: canonical posts, public game and player-visible personal records/Drop games may produce in-app owner receipts. People and restricted attested Clan facts never do; permissions are independent. No comment words leave the signed-in app.';

create or replace function timeline_comment_post_owner() returns trigger language plpgsql as $$
declare post_author uuid;
begin
  select account_id into post_author from account_post where item_id = new.item_id;
  if found then
    new.owner_account_id := post_author;
    new.owner_is_account := true;
    new.receipt_allowed := true;
  elsif exists (
    select 1 from attested_fact f
      where f.fact_type not in ('personal_record', 'drop_game')
        and new.item_id = 'tl_' || substr(encode(sha256(convert_to(
        'attested_fact|' || f.fact_id::text, 'UTF8')), 'hex'), 1, 20)
  ) then
    new.receipt_allowed := false;
  end if;
  return new;
end;
$$;
drop trigger timeline_comment_post_owner on timeline_comment;
create trigger timeline_comment_post_owner
  before insert or update of item_id, owner_account_id, owner_is_account, receipt_allowed
  on timeline_comment for each row execute function timeline_comment_post_owner();

update timeline_comment tc set owner_is_account = true
  from account_post p where p.item_id = tc.item_id;
update timeline_comment tc set receipt_allowed = false
  from attested_fact f
  where f.fact_type not in ('personal_record', 'drop_game')
    and tc.item_id = 'tl_' || substr(encode(sha256(convert_to(
    'attested_fact|' || f.fact_id::text, 'UTF8')), 'hex'), 1, 20);

update timeline_cheer tc set subject_tags = null
  from attested_fact f
  where tc.subject_tags is not null and f.fact_type <> 'personal_record'
    and tc.item_id = 'tl_' || substr(encode(sha256(convert_to(
      'attested_fact|' || f.fact_id::text, 'UTF8')), 'hex'), 1, 20);
