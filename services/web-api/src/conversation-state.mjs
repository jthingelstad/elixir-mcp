/** Private read position. A thread read never joins a conversation. */
import { commentSeenSql } from "./comment-visibility.mjs";
export async function readConversationThrough(
  db,
  readerId,
  item,
  commentIds,
  itemRef,
) {
  if (!commentIds.length) return;
  await db.query(
    `insert into comment_conversation_read(account_id,item_id,comment_id)
     select c.account_id,c.item_id,tc.comment_id
       from comment_conversation c join timeline_comment tc on tc.item_id=c.item_id
      where c.account_id=$1 and c.item_id=$2 and tc.comment_id=any($3::bigint[])
        and (tc.created_at,tc.comment_id)>(c.read_at,c.read_comment_id)
     order by tc.comment_id for key share of tc,c
     on conflict do nothing`,
    [readerId, item.id, commentIds],
  );
  await db.query(
    `with gap as (
       select tc.created_at,tc.comment_id from timeline_comment tc
         join account a on a.account_id=tc.account_id and a.kind='person' and a.status='approved'
         join comment_conversation c on c.item_id=tc.item_id and c.account_id=$1
        where tc.item_id=$2 and tc.account_id<>$1 and tc.status='visible'
          and ${commentSeenSql("$1::uuid")}
          and (tc.created_at,tc.comment_id)>(c.read_at,c.read_comment_id)
          and not exists(select 1 from comment_conversation_read r where r.account_id=$1 and r.comment_id=tc.comment_id)
        order by tc.created_at,tc.comment_id limit 1
     ), candidate as (
       select tc.created_at,tc.comment_id from timeline_comment tc
        where tc.item_id=$2 and tc.status='visible'
          and exists(select 1 from comment_conversation_read r where r.account_id=$1 and r.comment_id=tc.comment_id)
          and (not exists(select 1 from gap) or (tc.created_at,tc.comment_id)<(select created_at,comment_id from gap))
        order by tc.created_at desc,tc.comment_id desc limit 1
     ) update comment_conversation c set read_at=tc.created_at,
              read_comment_id=tc.comment_id,item_ref=$3::jsonb
         from candidate tc
        where c.account_id=$1 and c.item_id=$2
          and (c.read_at,c.read_comment_id)<(tc.created_at,tc.comment_id)`,
    [readerId, item.id, JSON.stringify(itemRef)],
  );
  // The contiguous cursor now represents these reads. Only exceptions
  // beyond an unread gap need their per-comment receipt; no comment or
  // participation is deleted. Concurrent cursors only move forward.
  await db.query(
    `delete from comment_conversation_read r using comment_conversation c,timeline_comment tc
      where c.account_id=$1 and c.item_id=$2 and r.account_id=c.account_id and r.item_id=c.item_id
        and tc.comment_id=r.comment_id and (tc.created_at,tc.comment_id)<=(c.read_at,c.read_comment_id)`,
    [readerId, item.id],
  );
}
