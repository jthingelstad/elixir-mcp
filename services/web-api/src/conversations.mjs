/** My conversations is private participation, never a notification audience.
 * Every source is admitted again before its title, counts or locator leave.
 * Reply words and authors are deliberately absent from this list. */
import { subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { commentSeenSql } from "./comment-visibility.mjs";
import { ownFeedItem } from "./cheers.mjs";
import { timelineItemRef } from "./timeline-item-ref.mjs";
import { recoverMemberItemRef } from "./timeline-items.mjs";

export const CONVERSATION_PAGE = 20;
export function conversationCursor(raw) {
  if (typeof raw !== "string" || raw.length > 300) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString());
    return typeof c.at === "string" &&
      Number.isFinite(Date.parse(c.at)) &&
      /^tl_[0-9a-f]{20}$/.test(c.id)
      ? c
      : null;
  } catch {
    return null;
  }
}

export async function readConversations(
  db,
  accountId,
  { posts = false, before = null } = {},
) {
  const { rows } = await db.query(
    `with joined as (
       select c.*, coalesce(r.latest_at,c.joined_at) as activity_at,
              coalesce(r.unread,0)::int as unread,r.first_unread
         from comment_conversation c
         left join lateral (
           select max(tc.created_at) as latest_at,
                  count(*) filter(where (tc.created_at,tc.comment_id) > (c.read_at,c.read_comment_id)
                    and not exists(select 1 from comment_conversation_read cr where cr.account_id=$1 and cr.comment_id=tc.comment_id))::int as unread,
                  (array_agg(tc.comment_id::text order by tc.created_at,tc.comment_id)
                    filter(where (tc.created_at,tc.comment_id) > (c.read_at,c.read_comment_id)
                      and not exists(select 1 from comment_conversation_read cr where cr.account_id=$1 and cr.comment_id=tc.comment_id)))[1] as first_unread
             from timeline_comment tc
             join account a on a.account_id=tc.account_id and a.kind='person' and a.status='approved'
            where tc.item_id=c.item_id and tc.account_id<>$1 and tc.status='visible'
              and ${commentSeenSql("$1::uuid")}
         ) r on true
        where c.account_id=$1)
     select *,to_char(activity_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
              to_char(read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as read_cursor_at
       from joined
      ${before ? "where (activity_at,item_id) < ($2::timestamptz,$3::text)" : ""}
      order by activity_at desc,item_id desc limit ${CONVERSATION_PAGE + 1}`,
    before ? [accountId, before.at, before.id] : [accountId],
  );
  const subjects = await subjectsFor(db, accountId);
  const page = rows.slice(0, CONVERSATION_PAGE);
  const items = [];
  for (const row of page) {
    const ref =
      row.item_ref ??
      (await recoverMemberItemRef(db, {
        accountId,
        itemId: row.item_id,
        subjectTag: row.legacy_subject_tag,
        commentedAt: row.joined_at,
        posts,
      }));
    if (!ref) continue;
    const item = await ownFeedItem(db, {
      accountId,
      itemId: row.item_id,
      tags: row.legacy_subject_tag ? [row.legacy_subject_tag] : [],
      subjects,
      posts,
      item: ref,
    });
    if (!item) continue;
    const canonicalRef = timelineItemRef(item);
    if (row.item_ref === null)
      await db.query(
        "update comment_conversation set item_ref=$3::jsonb where account_id=$1 and item_id=$2 and item_ref is null",
        [accountId, item.id, JSON.stringify(canonicalRef)],
      );
    items.push({
      item_id: item.id,
      item_ref: canonicalRef,
      title: excerpt(item.post?.text || item.text),
      question: item.post?.question === true,
      at: new Date(row.activity_at).toISOString(),
      unread: row.unread,
      first_unread_comment_id: row.first_unread ?? null,
      read_at: row.read_cursor_at,
      read_comment_id: String(row.read_comment_id),
    });
  }
  const last = page.at(-1);
  return {
    items,
    next_before:
      rows.length > CONVERSATION_PAGE && last
        ? Buffer.from(
            JSON.stringify({ at: last.cursor_at, id: last.item_id }),
          ).toString("base64url")
        : null,
  };
}

function excerpt(value) {
  const words = Array.from(String(value ?? ""));
  return words.length > 160
    ? words.slice(0, 159).join("") + "…"
    : words.join("");
}
