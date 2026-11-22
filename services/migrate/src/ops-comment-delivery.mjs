/**
 * The comment-delivery check ({comment_delivery: {tag: "#TAG"}}), a read.
 *
 * The bell is the one place a comment reaches the person it is about
 * (DECISIONS "Comments, checked before they post"; web-api bell.mjs
 * readComments). When someone says a comment never reached them, this says
 * which of the bell's conditions each comment about their player passes:
 *
 *   - `owner_set`: the comment names an owner account (`owner_account_id`)
 *   - `owner_holds_claim`: that owner holds a verified primary or alt claim
 *     on the tag now (game items), or the comment is on a post of theirs
 *   - `receipt_allowed`: the item allowed a receipt when it was written
 *     (not a clan story; public or player visibility)
 *   - `visible`: the comment's status is `visible`
 *   - `post_ok`: not on a post, or on a visible post of the owner's
 *   - `audience_ok`: no clan audience, or the owner sits in that clan now
 *   - `blocked`: a block stands between author and owner
 *   - `reported`: the owner has an open report on it
 *   - `in_window`: written in the bell's seven days
 *   - `after_seen`: written after the owner last marked the bell seen
 *
 * plus the tag's claims (status, relationship, whether primary) and, per
 * owner, when the bell was last marked seen. No body, name or address;
 * accounts by an eight-character id prefix. A read-only session.
 */

import pg from "pg";

const DAYS = 30;
const BELL_DAYS = 7;

export async function commentDeliveryOp(databaseUrl, spec = {}) {
  const tag = typeof spec?.tag === "string" ? spec.tag.trim() : "";
  if (!/^#[0-9A-Z]{3,15}$/.test(tag))
    return { error: 'comment_delivery takes {tag: "#TAG"}' };
  const days = Number.isInteger(spec.days)
    ? Math.min(Math.max(spec.days, 1), 90)
    : DAYS;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set default_transaction_read_only = on");
    const { rows: claims } = await db.query(
      `select left(c.account_id::text, 8) as account, c.status,
              c.relationship, c.is_primary, c.verified_at
         from claim c where c.player_tag = $1
        order by c.is_primary desc, c.status, c.relationship`,
      [tag],
    );
    const { rows: comments } = await db.query(
      `select tc.created_at, tc.status,
              left(tc.account_id::text, 8) as author,
              left(tc.owner_account_id::text, 8) as owner,
              tc.owner_account_id is not null as owner_set,
              tc.owner_is_account, tc.receipt_allowed,
              tc.audience_clan is not null as has_audience,
              p.post_id is not null as on_post,
              (p.post_id is null or (p.status = 'visible' and p.account_id = tc.owner_account_id)) as post_ok,
              (case when tc.owner_is_account
                    then p.post_id is not null and p.account_id = tc.owner_account_id
                    else exists (select 1 from claim own
                       where own.player_tag = tc.subject_tag
                         and own.account_id = tc.owner_account_id
                         and own.status = 'verified'
                         and (own.is_primary or own.relationship in ('primary','alt')))
               end) as owner_holds_claim,
              (tc.audience_clan is null or exists (
                 select 1 from claim seat
                   join clan_membership cm on cm.player_tag = seat.player_tag
                                          and cm.left_observed_at is null
                  where seat.account_id = tc.owner_account_id
                    and seat.status = 'verified'
                    and (seat.is_primary or seat.relationship in ('primary','alt'))
                    and cm.clan_tag = tc.audience_clan)) as audience_ok,
              exists (select 1 from account_block ab
                 where (ab.account_id = tc.account_id and ab.blocked_account_id = tc.owner_account_id)
                    or (ab.account_id = tc.owner_account_id and ab.blocked_account_id = tc.account_id))
                as blocked,
              exists (select 1 from comment_report cr
                 where cr.comment_id = tc.comment_id
                   and cr.account_id = tc.owner_account_id
                   and cr.resolved_at is null) as reported,
              tc.created_at > now() - make_interval(days => $3) as in_window,
              (bs.seen_at is null or tc.created_at > bs.seen_at) as after_seen
         from timeline_comment tc
         left join account_post p on p.item_id = tc.item_id
         left join bell_seen bs on bs.account_id = tc.owner_account_id
        where (tc.subject_tag = $1 or p.player_tag = $1)
          and tc.created_at > now() - make_interval(days => $2)
        order by tc.created_at desc`,
      [tag, days, BELL_DAYS],
    );
    const { rows: seen } = await db.query(
      `select left(bs.account_id::text, 8) as account, bs.seen_at
         from bell_seen bs
        where bs.account_id in (select account_id from claim where player_tag = $1)`,
      [tag],
    );
    return { tag, days, claims, comments, bell_seen: seen };
  } finally {
    await db.end();
  }
}
