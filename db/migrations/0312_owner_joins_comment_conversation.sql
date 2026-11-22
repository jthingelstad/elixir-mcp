-- 0312: an item's owner joins the conversation others start on it
-- (2026-11-22).
--
-- Jamie, 2026-11-22: "Conversations should also pull in people commenting
-- on your timeline items." Until now My conversations held only threads
-- you joined by commenting (0303), and the bell marked a comment on your
-- item seen as soon as the bell was opened, even when its row was never on
-- screen. From here, someone else's accepted comment on an item about your
-- Verified player, or on your post, joins you to that item's conversation
-- with your read position just before it: the comment is unread in My
-- conversations and new in the bell until you open the thread, which
-- advances the position as it does for every member (conversation-state
-- readConversationThrough). Nobody is sent anything new
-- (docs/notes/2026-11-22-owner-joins-conversation.md).
--
-- The owner is timeline_comment.owner_account_id, which postChecked
-- resolves at write time (the verified-player owner of a game item, the
-- author of a post); only comments that allow the owner a receipt join
-- (receipt_allowed), the same ones the bell carries. The position sits one
-- microsecond before the comment with comment id 1: every later comment
-- compares after it.
--
-- The trigger 0303 made now also joins the owner. The backfill joins the
-- owners of existing visible comments by others, positioned before the
-- earliest one, so they read as unread. Production census for 0311:
-- timeline_comment held a few dozen rows; one bounded set-based insert.
-- vacuum after: comment_conversation

create or replace function join_comment_conversation() returns trigger language plpgsql as $$
begin
  if new.status = 'visible' then
    insert into comment_conversation(account_id,item_id,legacy_subject_tag,joined_at,read_at,read_comment_id)
    values(new.account_id,new.item_id,new.subject_tag,new.created_at,new.created_at,new.comment_id)
    on conflict(account_id,item_id) do nothing;
    if new.owner_account_id is not null and new.owner_account_id <> new.account_id
       and new.receipt_allowed then
      insert into comment_conversation(account_id,item_id,legacy_subject_tag,joined_at,read_at,read_comment_id)
      values(new.owner_account_id,new.item_id,new.subject_tag,new.created_at,
             new.created_at - interval '1 microsecond',1)
      on conflict(account_id,item_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

insert into comment_conversation(account_id,item_id,item_ref,legacy_subject_tag,joined_at,read_at,read_comment_id)
select distinct on (tc.owner_account_id, tc.item_id)
       tc.owner_account_id, tc.item_id, src.item_ref, tc.subject_tag,
       tc.created_at, tc.created_at - interval '1 microsecond', 1
  from timeline_comment tc
  join account o on o.account_id = tc.owner_account_id
  left join lateral (
    select c.item_ref from comment_conversation c
     where c.item_id = tc.item_id and c.item_ref is not null limit 1
  ) src on true
 where tc.status = 'visible' and tc.receipt_allowed
   and tc.owner_account_id is not null and tc.owner_account_id <> tc.account_id
 order by tc.owner_account_id, tc.item_id, tc.created_at, tc.comment_id
on conflict (account_id, item_id) do nothing;
