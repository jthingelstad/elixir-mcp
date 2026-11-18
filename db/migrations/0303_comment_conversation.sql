-- 0303: private participation and read position for My conversations.
-- Jamie, 2026-11-18: resume conversations a member actually joined.
-- This new table records no subscriptions and emits no notifications.
-- Existing comment authors start at their latest own contribution; their
-- words and the source record are untouched. Source access is rechecked.
-- Production census for 0300: timeline_comment had four rows. This bounded
-- copy takes no lock on its source beyond an ordinary read.
-- vacuum after: comment_conversation
create table comment_conversation (
  account_id uuid not null references account(account_id) on delete cascade,
  item_id text not null check(item_id ~ '^tl_[0-9a-f]{20}$'),
  item_ref jsonb,
  legacy_subject_tag text,
  joined_at timestamptz not null,
  read_at timestamptz not null,
  read_comment_id bigint not null check(read_comment_id > 0),
  primary key(account_id,item_id)
);
comment on table comment_conversation is
  '0303: private threads a member joined by posting an accepted comment. Membership grants no source access and creates no push, email or public activity.';
comment on column comment_conversation.item_ref is
  'Canonical source locator captured on participation or an authorized thread read. Null for historical comments until their exact source is recovered; never submitted facts or authority.';
comment on column comment_conversation.legacy_subject_tag is
  'Historical comment subject used only to narrow exact source recovery, never to infer an item or grant access.';
comment on column comment_conversation.read_at is
  'Together with read_comment_id, the contiguous read position. Receipts preserve reads beyond earlier unread gaps. Initially the first own comment, or latest own contribution for historical members. Bell reads do not advance it.';
comment on column comment_conversation.read_comment_id is
  'Timestamp tie-breaker for the contiguous read position. Read exceptions beyond unread gaps live in comment_conversation_read; never a high-water ID across threads.';
create table comment_conversation_read (
  account_id uuid not null,
  item_id text not null,
  comment_id bigint not null references timeline_comment(comment_id) on delete cascade,
  primary key(account_id,comment_id),
  foreign key(account_id,item_id) references comment_conversation(account_id,item_id) on delete cascade
);
comment on table comment_conversation_read is
  '0303: private read receipts for comments actually served to a participant, including pages beyond an unread gap. Covered receipts are pruned once represented by the contiguous cursor. A receipt never joins a thread or grants source access, and goes with its comment or membership.';
insert into comment_conversation(account_id,item_id,legacy_subject_tag,joined_at,read_at,read_comment_id)
select distinct on (account_id,item_id) account_id,item_id,subject_tag,
       min(created_at) over(partition by account_id,item_id),created_at,comment_id
  from timeline_comment
 order by account_id,item_id,created_at desc,comment_id desc;

-- Preserve participation written by the previous Lambda between migration
-- and cutover too. Its missing locator is recovered like historical rows.
create function join_comment_conversation() returns trigger language plpgsql as $$
begin
  if new.status = 'visible' then
    insert into comment_conversation(account_id,item_id,legacy_subject_tag,joined_at,read_at,read_comment_id)
    values(new.account_id,new.item_id,new.subject_tag,new.created_at,new.created_at,new.comment_id)
    on conflict(account_id,item_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger join_comment_conversation after insert on timeline_comment
  for each row execute function join_comment_conversation();
