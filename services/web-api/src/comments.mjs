/**
 * Comments (2026-11-16; Jamie: "I'm open to comments and I think we could
 * use Haiku or something similar to review every comment before it is
 * submitted to avoid moderation issues"). DECISIONS "Comments, checked
 * before they post".
 *
 * A comment is a few words of plain text (280 characters, no links, no
 * images, mentioning nobody) on one timeline item about a player whose
 * owner is a verified account. One level, no threads.
 *
 * Who may comment: a signed-in person with a Verified player of their
 * own, on an item in their own feed now, as the item's owner's comment
 * setting allows: "followers" (the default: they follow the owner's
 * account or one of the owner's players), "following" (the owner follows
 * them), or "nobody". The owner may always comment on their own items.
 * Items with no verified owner (a clan's news, a player nobody has
 * verified) take no comments: nobody could set who may comment, remove
 * a comment or block on that player's behalf [engineering, 2026-11-16].
 * Agents never comment, and nothing over MCP reads or writes one.
 *
 * Who sees them: the readers of the item, in the feed and on its pages,
 * never anyone in a block with the author (either way). The words never
 * reach the digest, RSS, Discord, shared public pages or MCP.
 *
 * Every comment passes the check first (comment-check.mjs): cheap
 * filters, then the model. Rate limits and a cooldown after repeated
 * refusals are counted from the checks.
 *
 * Who may remove one: its author (deleted at once), the owner of the
 * player the item is about (removed, kept for admins 30 days), an admin.
 * Two reports from different accounts hide it until an admin decides.
 */
import { blockedSql, blockedWith } from "@elixir-mcp/claims";
import { ITEM_ID_RE } from "@elixir-mcp/tools/activity/cheers";
import { checkComment, REFUSAL_WORDS } from "./comment-check.mjs";
import { tidyComment } from "./comment-filter.mjs";
import { ID_RE } from "./http.mjs";

/** The latest comments a feed card shows. */
export const CARD_LATEST = 2;
/** The most comments one item's list returns. */
export const ITEM_MAX = 100;
/** Checks one account may start: per minute and per day. */
export const PER_MINUTE = 5;
export const PER_DAY = 40;
/** Refusals in an hour that start a cooldown, and how long it lasts. */
export const COOLDOWN_AFTER = 3;
export const COOLDOWN_MINUTES = 60;
/** Distinct reports that hide a comment until an admin decides. */
export const HIDE_AT_REPORTS = 2;
/* A removed comment stays 30 days for admins, and a check's row (with a
 * refusal's words) 35 days: services/jobs sweepOperational deletes them. */

export const SETTINGS = ["followers", "following", "nobody"];
export const REPORT_REASONS = [
  "bullying",
  "sexual",
  "hate",
  "threat",
  "self_harm",
  "spam",
  "personal_info",
  "other",
];

/** The player an item is about, or null (a clan's news). */
export function itemPlayer(item) {
  const sub = (item?.subjects ?? []).find((s) => s?.kind === "player");
  return sub?.tag ?? null;
}

/** Whether the account has a Verified player of its own. */
async function hasVerifiedPlayer(db, accountId) {
  const { rows } = await db.query(
    `select 1 from claim where account_id = $1 and status = 'verified'
        and (is_primary or relationship in ('primary', 'alt')) limit 1`,
    [accountId],
  );
  return rows.length > 0;
}

/** An account's comment setting: `{ who, suspended_until }`. */
export async function commentSettingOf(db, accountId) {
  const { rows } = await db.query(
    // A pause that has ended reads as none (Codex on #1081): openOwners
    // enforces only one still running, and nothing clears the column.
    `select who,
            case when suspended_until > now() then suspended_until end
              as suspended_until
       from comment_setting where account_id = $1`,
    [accountId],
  );
  return {
    who: rows[0]?.who ?? "followers",
    suspended_until: rows[0]?.suspended_until
      ? new Date(rows[0].suspended_until).toISOString()
      : null,
  };
}

/** Set who may comment on the account's play. */
export async function setCommentSetting(db, accountId, who) {
  if (!SETTINGS.includes(who)) return { error: "invalid_setting" };
  await db.query(
    `insert into comment_setting (account_id, who) values ($1, $2)
     on conflict (account_id) do update set who = excluded.who, updated_at = now()`,
    [accountId, who],
  );
  return commentSettingOf(db, accountId);
}

/**
 * For one reader and the owners of some items: whether the reader may
 * comment on each owner's items, as a Map of owner id to boolean. Six
 * small reads, whatever the number of owners.
 */
async function openOwners(db, readerId, ownerIds) {
  const out = new Map();
  const owners = [...new Set(ownerIds.filter(Boolean))];
  if (owners.length === 0) return out;
  if (!(await hasVerifiedPlayer(db, readerId))) {
    for (const o of owners) out.set(o, false);
    return out;
  }
  const { rows: mine } = await db.query(
    `select suspended_until > now() as suspended from comment_setting
      where account_id = $1`,
    [readerId],
  );
  const suspended = mine[0]?.suspended === true;
  const blocked = await blockedWith(db, readerId);
  const { rows: settings } = await db.query(
    `select account_id, who from comment_setting where account_id = any($1::uuid[])`,
    [owners],
  );
  const who = new Map(settings.map((r) => [r.account_id, r.who]));
  // The reader follows the owner: the account, or one of its own players.
  const { rows: follows } = await db.query(
    `select followed_account_id as id from account_follow
      where account_id = $1 and followed_account_id = any($2::uuid[])
     union
     select o.account_id from claim f
       join claim o on o.player_tag = f.player_tag
                   and (o.is_primary or o.relationship in ('primary', 'alt'))
                   and o.status = 'verified'
      where f.account_id = $1 and f.relationship = 'friend' and not f.is_primary
        and o.account_id = any($2::uuid[])`,
    [readerId, owners],
  );
  const iFollow = new Set(follows.map((r) => r.id));
  // The owner follows the reader, the same two ways.
  const { rows: back } = await db.query(
    `select account_id as id from account_follow
      where followed_account_id = $1 and account_id = any($2::uuid[])
     union
     select f.account_id from claim f
       join claim me on me.player_tag = f.player_tag and me.account_id = $1
                    and (me.is_primary or me.relationship in ('primary', 'alt'))
      where f.relationship = 'friend' and not f.is_primary
        and f.account_id = any($2::uuid[])`,
    [readerId, owners],
  );
  const followsMe = new Set(back.map((r) => r.id));
  for (const o of owners) {
    if (o === readerId) {
      out.set(o, !suspended);
      continue;
    }
    if (suspended || blocked.has(o)) {
      out.set(o, false);
      continue;
    }
    const setting = who.get(o) ?? "followers";
    out.set(
      o,
      setting === "followers"
        ? iFollow.has(o)
        : setting === "following"
          ? followsMe.has(o)
          : false,
    );
  }
  return out;
}

/** The verified owner of each player tag: a Map of tag to account id. */
async function ownersOf(db, tags) {
  const list = [...new Set(tags.filter(Boolean))];
  if (list.length === 0) return new Map();
  const { rows } = await db.query(
    `select distinct on (c.player_tag) c.player_tag, c.account_id
       from claim c
       join account a on a.account_id = c.account_id
                     and a.kind = 'person' and a.status = 'approved'
      where c.player_tag = any($1::text[]) and c.status = 'verified'
        and (c.is_primary or c.relationship in ('primary', 'alt'))
      order by c.player_tag, c.verified_at`,
    [list],
  );
  return new Map(rows.map((r) => [r.player_tag, r.account_id]));
}

/** A post and its answers belong to its author, even after its player
 * claim changes. Game items keep the player's current verified owner. */
async function ownersForItems(db, items) {
  const game = items.filter((it) => it?.kind !== "post");
  const players = await ownersOf(db, game.map(itemPlayer));
  const owners = new Map(
    game
      .filter((it) => it?.id)
      .map((it) => [it.id, players.get(itemPlayer(it))]),
  );
  const posts = items
    .filter((it) => it?.kind === "post" && it.id)
    .map((it) => it.id);
  if (posts.length) {
    const { rows } = await db.query(
      `select item_id,account_id from account_post
      where item_id=any($1::text[]) and status <> 'removed'`,
      [posts],
    );
    for (const row of rows) owners.set(row.item_id, row.account_id);
  }
  return owners;
}

const COMMENT_COLS = `tc.comment_id::text as comment_id, tc.item_id, tc.body,
       tc.created_at, tc.account_id, tc.owner_account_id, tc.status,
       ap.passport_id as author_page, pc.player_tag as author_tag,
       pp.name as author_name, pc.status = 'verified' as author_verified`;
const AUTHOR_JOIN = `join account a on a.account_id = tc.account_id
                     and a.kind = 'person' and a.status = 'approved'
       left join account_passport ap on ap.account_id = tc.account_id
       left join claim pc on pc.account_id = tc.account_id and pc.is_primary
       left join player pp on pp.player_tag = pc.player_tag`;
/** What a reader sees: visible comments, and their own while hidden for
 *  review (a report never reaches the reported person), never anyone's
 *  in a block with the reader, and never one the reader reported while
 *  the report is open. `r` is the reader's SQL parameter. */
export const commentSeenSql = (r) => `(tc.status = 'visible'
         or (tc.status = 'hidden' and tc.account_id = ${r}))
        and not ${blockedSql("tc.account_id", r)}
        and not exists (select 1 from comment_report cr
                         where cr.comment_id = tc.comment_id
                           and cr.account_id = ${r} and cr.resolved_at is null)`;

function shape(row, { readerId, isAdmin = false }) {
  const mine = row.account_id === readerId;
  return {
    id: row.comment_id,
    item_id: row.item_id,
    text: String(row.body ?? ""),
    at: row.created_at ? new Date(row.created_at).toISOString() : null,
    author: {
      account_id: row.author_page ?? null,
      player_tag: row.author_tag ?? null,
      name: row.author_name ?? null,
      verified: row.author_verified === true,
    },
    mine,
    can_delete: mine || row.owner_account_id === readerId || isAdmin,
    can_report: !mine,
    can_block: !mine,
  };
}

/**
 * The feed's items with their comments (2026-11-16): on each item that
 * can carry them, `comments: { count, latest, open }`: how many the
 * reader can see, the newest CARD_LATEST (oldest first, as they read),
 * and whether the reader may add one. Read live for the page, one
 * windowed statement plus the access reads, never stored, so a count is
 * never staler than the page. Items no verified owner stands behind
 * carry `comments: null`. `enabled` false leaves the items as they are.
 */
export async function withComments(db, items, readerId, { enabled = false }) {
  if (!enabled || !readerId) return items;
  const owners = await ownersForItems(db, items);
  const ids = items
    .filter((it) => it?.id && ITEM_ID_RE.test(it.id) && owners.get(it.id))
    .map((it) => it.id);
  const found = new Map();
  if (ids.length) {
    const { rows } = await db.query(
      `with seen as (
         select ${COMMENT_COLS},
                row_number() over (partition by tc.item_id
                                   order by tc.created_at desc, tc.comment_id desc) as rn,
                count(*) over (partition by tc.item_id)::int as n
           from timeline_comment tc
           ${AUTHOR_JOIN}
          where tc.item_id = any($1::text[]) and ${commentSeenSql("$2::uuid")})
       select * from seen where rn <= $3
        order by item_id, created_at, comment_id`,
      [ids, readerId, CARD_LATEST],
    );
    for (const r of rows) {
      const one = found.get(r.item_id) ?? { count: r.n, latest: [] };
      one.latest.push(shape(r, { readerId }));
      found.set(r.item_id, one);
    }
  }
  const open = await openOwners(db, readerId, [...owners.values()]);
  return items.map((it) => {
    if (!it?.id || it.section === "account") return it;
    const owner = owners.get(it.id);
    if (!owner) return { ...it, comments: null };
    const got = found.get(it.id);
    return {
      ...it,
      comments: {
        count: got?.count ?? 0,
        latest: got?.latest ?? [],
        open: open.get(owner) === true,
      },
    };
  });
}

/** One item's comments for a reader, oldest first: `{ comments, count,
 *  open }`. The caller has checked the item is in the reader's feed. */
export async function commentsOnItem(
  db,
  readerId,
  item,
  { before = null, around = null } = {},
) {
  const owner = (await ownersForItems(db, [item])).get(item.id) ?? null;
  if (!owner)
    return {
      item_id: item.id,
      comments: [],
      count: 0,
      open: false,
      next_before: null,
    };
  let anchor = null;
  if (around && !before) {
    anchor =
      (
        await db.query(
          `select tc.created_at::text as at, tc.comment_id::text as id
      from timeline_comment tc ${AUTHOR_JOIN}
      where tc.item_id=$1 and ${commentSeenSql("$2::uuid")} and tc.comment_id=$3::bigint`,
          [item.id, readerId, around],
        )
      ).rows[0] ?? null;
  }
  const edge = before ?? anchor;
  const { rows } = await db.query(
    `select ${COMMENT_COLS}, to_char(tc.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
       from timeline_comment tc ${AUTHOR_JOIN}
      where tc.item_id = $1 and ${commentSeenSql("$2::uuid")}
      ${edge ? `and (tc.created_at,tc.comment_id) ${before ? "<" : "<="} ($3::timestamptz,$4::bigint)` : ""}
      order by tc.created_at desc, tc.comment_id desc limit ${ITEM_MAX + 1}`,
    edge ? [item.id, readerId, edge.at, edge.id] : [item.id, readerId],
  );
  const page = rows.slice(0, ITEM_MAX);
  const last = page.at(-1);
  const next =
    rows.length > ITEM_MAX && last
      ? Buffer.from(
          JSON.stringify({ at: last.cursor_at, id: last.comment_id }),
        ).toString("base64url")
      : null;
  const open = await openOwners(db, readerId, [owner]);
  const comments = page.reverse().map((r) => shape(r, { readerId }));
  return {
    item_id: item.id,
    comments,
    count: comments.length,
    open: open.get(owner) === true,
    next_before: next,
    anchored: Boolean(anchor),
  };
}

/** An opaque backwards page, preserving PostgreSQL timestamp precision. */
export const validCommentId = (id) => ID_RE.test(String(id)) && BigInt(id) > 0n;

export function readCommentCursor(raw) {
  try {
    const c = JSON.parse(Buffer.from(String(raw), "base64url").toString());
    return typeof c.at === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(c.at) &&
      c.at.slice(0, 4) !== "0000" &&
      new Date(c.at).toISOString().slice(0, 19) === c.at.slice(0, 19) &&
      typeof c.id === "string" &&
      validCommentId(c.id)
      ? { at: c.at, id: c.id }
      : null;
  } catch {
    return null;
  }
}

/** Why the account may not start a check now, or null: the per-minute and
 *  per-day caps on comments, and the cooldown after repeated refusals of
 *  comments and posts alike (posts.mjs keeps its own caps). */
async function throttled(db, accountId) {
  const { rows } = await db.query(
    `select count(*) filter (where kind = 'comment'
                               and created_at > now() - interval '1 minute')::int as minute,
            count(*) filter (where kind = 'comment')::int as day,
            count(*) filter (where verdict = 'refuse'
                               and created_at > now() - make_interval(mins => $2))::int as refused,
            min(created_at) filter (where verdict = 'refuse'
                               and created_at > now() - make_interval(mins => $2)) as first_refused
       from comment_check
      where account_id = $1 and created_at > now() - interval '1 day'`,
    [accountId, COOLDOWN_MINUTES],
  );
  const r = rows[0];
  if (r.refused >= COOLDOWN_AFTER)
    return {
      error: "cooldown",
      until: new Date(
        new Date(r.first_refused).getTime() + COOLDOWN_MINUTES * 60_000,
      ).toISOString(),
    };
  if (r.minute >= PER_MINUTE) return { error: "rate_limited", retry: 60 };
  if (r.day >= PER_DAY) return { error: "rate_limited", retry: 3600 };
  return null;
}

/** The same words from the same author in the last day: spam. */
async function repeated(db, accountId, body) {
  const { rows } = await db.query(
    `select 1 from timeline_comment
      where account_id = $1 and lower(body) = lower($2)
        and created_at > now() - interval '1 day' limit 1`,
    [accountId, body],
  );
  return rows.length > 0;
}

/**
 * Post a comment on an item in the reader's feed (`item`, as ownFeedItem
 * found it). `comments` is `{ enabled, capUsd, moderate }`. Returns
 * `{ ok, comment }` or `{ error, category?, message }`.
 */
export async function postComment(db, account, item, raw, comments) {
  if (!comments?.enabled) return { error: "comments_off" };
  const readerId = account.accountId;
  const tag = itemPlayer(item);
  const owner = (await ownersForItems(db, [item])).get(item.id) ?? null;
  if (!owner)
    return {
      error: "not_open",
      message: "This one doesn't take comments.",
    };
  if (!(await hasVerifiedPlayer(db, readerId)))
    return {
      error: "not_verified",
      message: "Verify your player to comment.",
    };
  const open = await openOwners(db, readerId, [owner]);
  if (!open.get(owner))
    return {
      error: "not_open",
      message: "You can't comment on this one.",
    };
  // One post at a time per account: the limits count logged checks, and a
  // check is logged only once the model answers, so parallel posts could
  // all pass the count (Codex on #1078). A second post while one is being
  // checked is told to wait; the session lock goes with the request's
  // connection if anything dies.
  const key = `comment-post:${readerId}`;
  const { rows: got } = await db.query(
    "select pg_try_advisory_lock(hashtext($1)) as ok",
    [key],
  );
  if (!got[0]?.ok)
    return {
      error: "rate_limited",
      retry: 5,
      message: "Your last comment is still being checked. Try again soon.",
    };
  try {
    return await postChecked(db, readerId, item, raw, comments, tag, owner);
  } finally {
    await db.query("select pg_advisory_unlock(hashtext($1))", [key]);
  }
}

/** The rest of postComment, under the account's post lock. */
async function postChecked(db, readerId, item, raw, comments, tag, owner) {
  const slow = await throttled(db, readerId);
  if (slow?.error === "cooldown")
    return {
      ...slow,
      message: "Take a break from comments for a bit, then try again.",
    };
  if (slow)
    return { ...slow, message: "That's a lot of comments. Try again soon." };
  const body = tidyComment(raw);
  if (body && (await repeated(db, readerId, body))) {
    return { error: "refused", category: "spam", message: REFUSAL_WORDS.spam };
  }
  const verdict = await checkComment(db, {
    moderate: comments.moderate,
    capUsd: comments.capUsd,
    accountId: readerId,
    itemId: item.id,
    body,
    about: String(item.text ?? ""),
    own: owner === readerId,
  });
  if (verdict.verdict === "paused")
    return { error: "paused", message: REFUSAL_WORDS.paused };
  if (verdict.verdict === "error")
    return { error: "unavailable", message: REFUSAL_WORDS.unavailable };
  if (verdict.verdict === "refuse")
    return {
      error: "refused",
      category: verdict.category,
      message: REFUSAL_WORDS[verdict.category] ?? REFUSAL_WORDS.harassment,
    };
  const { rows } = await db.query(
    `insert into timeline_comment
       (item_id, account_id, subject_tag, owner_account_id, body)
     values ($1, $2, $3, $4, $5)
     returning comment_id`,
    [item.id, readerId, tag, owner, body],
  );
  const { rows: back } = await db.query(
    `select ${COMMENT_COLS} from timeline_comment tc ${AUTHOR_JOIN}
      where tc.comment_id = $1`,
    [rows[0].comment_id],
  );
  return { ok: true, comment: shape(back[0], { readerId }) };
}

/** One comment's row, or null. */
async function commentRow(db, id) {
  if (!/^[1-9][0-9]{0,18}$/.test(String(id ?? ""))) return null;
  const { rows } = await db.query(
    `select comment_id::text as comment_id, account_id, owner_account_id,
            status, item_id, subject_tag
       from timeline_comment where comment_id = $1::bigint`,
    [String(id)],
  );
  return rows[0] ?? null;
}

/** Delete or remove a comment: the author's own goes at once; the item
 *  owner's removal keeps it for admins. `{ ok }` or `{ error }`. */
export async function deleteComment(db, account, id) {
  const row = await commentRow(db, id);
  if (!row || row.status === "removed") return { error: "not_found" };
  if (row.account_id === account.accountId) {
    await db.query(
      `delete from timeline_comment where comment_id = $1::bigint`,
      [row.comment_id],
    );
    return { ok: true, deleted: true };
  }
  if (row.owner_account_id === account.accountId) {
    await removeComment(db, row.comment_id, "owner");
    return { ok: true, removed: true };
  }
  return { error: "not_found" };
}

/** Remove a comment, by its item's owner or an admin: kept for admins
 *  30 days (sweepOperational), its open reports resolved as removed. */
export async function removeComment(db, id, by) {
  const { rowCount } = await db.query(
    `update timeline_comment
        set status = 'removed', removed_by = $2, removed_at = now()
      where comment_id = $1::bigint and status <> 'removed'`,
    [String(id), by],
  );
  await db.query(
    `update comment_report set resolved_at = now(), resolution = 'removed'
      where comment_id = $1::bigint and resolved_at is null`,
    [String(id)],
  );
  return rowCount > 0;
}

/** Report a comment the reader can see. Two reports from different
 *  accounts hide it until an admin decides. Never told to its author. */
export async function reportComment(db, account, id, reason, canSee) {
  if (!REPORT_REASONS.includes(reason)) return { error: "invalid_reason" };
  const row = await commentRow(db, id);
  if (!row || row.status !== "visible") return { error: "not_found" };
  if (row.account_id === account.accountId) return { error: "not_found" };
  const blocked = await blockedWith(db, account.accountId);
  if (blocked.has(row.account_id)) return { error: "not_found" };
  // Only a comment the reporter may read: its item in their own feed, as
  // the list and the post require. Ids are sequential, so without this two
  // accounts could hide comments they were never shown (Codex on #1078).
  if (!(await canSee(row))) return { error: "not_found" };
  await db.query(
    `insert into comment_report (comment_id, account_id, reason)
     values ($1::bigint, $2, $3)
     on conflict (comment_id, account_id) do update
       set reason = excluded.reason
     where comment_report.resolved_at is null`,
    [row.comment_id, account.accountId, reason],
  );
  const { rows } = await db.query(
    `select count(distinct account_id)::int as n from comment_report
      where comment_id = $1::bigint and resolved_at is null`,
    [row.comment_id],
  );
  if (rows[0].n >= HIDE_AT_REPORTS)
    await db.query(
      `update timeline_comment set status = 'hidden'
        where comment_id = $1::bigint and status = 'visible'`,
      [row.comment_id],
    );
  // The reporter stops seeing it at once, whatever the count (SEEN).
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

/** The admin queue: comments with open reports or hidden for review,
 *  recent refusals with their words, and the month's spend. */
export async function commentQueue(db) {
  const { rows: reported } = await db.query(
    `select ${COMMENT_COLS}, tc.subject_tag,
            coalesce(json_agg(json_build_object('reason', r.reason,
                       'at', r.created_at) order by r.created_at)
                     filter (where r.comment_id is not null), '[]') as reports
       from timeline_comment tc
       ${AUTHOR_JOIN}
       left join comment_report r on r.comment_id = tc.comment_id
                                 and r.resolved_at is null
      where tc.status = 'hidden'
         or exists (select 1 from comment_report o
                     where o.comment_id = tc.comment_id and o.resolved_at is null)
      group by tc.comment_id, ap.passport_id, pc.player_tag, pp.name, pc.status
      order by min(r.created_at) nulls last, tc.created_at
      limit 100`,
  );
  const { rows: refused } = await db.query(
    `select cc.check_id::text as check_id, cc.created_at, cc.stage,
            cc.category, cc.body, cc.kind, ap.passport_id as author_page,
            pc.player_tag as author_tag, pp.name as author_name
       from comment_check cc
       left join account_passport ap on ap.account_id = cc.account_id
       left join claim pc on pc.account_id = cc.account_id and pc.is_primary
       left join player pp on pp.player_tag = pc.player_tag
      where cc.verdict = 'refuse'
      order by cc.created_at desc limit 100`,
  );
  const { rows: month } = await db.query(
    `select coalesce(sum(cost_usd), 0)::text as usd,
            count(*)::int as checks,
            count(*) filter (where verdict = 'allow')::int as allowed,
            count(*) filter (where verdict = 'refuse')::int as refused,
            count(*) filter (where verdict = 'error')::int as errors,
            count(*) filter (where verdict = 'paused')::int as paused
       from comment_check
      where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`,
  );
  const { rows: suspended } = await db.query(
    `select ap.passport_id as account_id, pc.player_tag, pp.name, s.suspended_until
       from comment_setting s
       left join account_passport ap on ap.account_id = s.account_id
       left join claim pc on pc.account_id = s.account_id and pc.is_primary
       left join player pp on pp.player_tag = pc.player_tag
      where s.suspended_until > now()
      order by s.suspended_until`,
  );
  return {
    reported: reported.map((r) => ({
      ...shape(r, { readerId: null, isAdmin: true }),
      status: r.status,
      subject_tag: r.subject_tag,
      reports: r.reports,
    })),
    refused: refused.map((r) => ({
      id: r.check_id,
      at: new Date(r.created_at).toISOString(),
      stage: r.stage,
      category: r.category,
      kind: r.kind,
      text: r.body ?? "",
      author: {
        account_id: r.author_page ?? null,
        player_tag: r.author_tag ?? null,
        name: r.author_name ?? null,
      },
    })),
    month: { ...month[0], usd: Number(month[0].usd) },
    suspended: suspended.map((r) => ({
      account_id: r.account_id,
      player_tag: r.player_tag ?? null,
      name: r.name ?? null,
      until: new Date(r.suspended_until).toISOString(),
    })),
  };
}

/** An admin's dismissal: the open reports are closed and a hidden
 *  comment shows again. */
export async function dismissReports(db, id) {
  const row = await commentRow(db, id);
  if (!row) return { error: "not_found" };
  await db.query(
    `update comment_report set resolved_at = now(), resolution = 'dismissed'
      where comment_id = $1::bigint and resolved_at is null`,
    [row.comment_id],
  );
  await db.query(
    `update timeline_comment set status = 'visible'
      where comment_id = $1::bigint and status = 'hidden'`,
    [row.comment_id],
  );
  return { ok: true };
}

/** An admin's suspension of an account's commenting, for `days` (0 ends
 *  it). The account is named by its page id. */
export async function suspendCommenting(db, accountId, days) {
  const n = Number(days);
  if (!Number.isInteger(n) || n < 0 || n > 3650)
    return { error: "invalid_days" };
  await db.query(
    `insert into comment_setting (account_id, suspended_until)
     values ($1, case when $2::int = 0 then null else now() + make_interval(days => $2) end)
     on conflict (account_id) do update
       set suspended_until = excluded.suspended_until, updated_at = now()`,
    [accountId, n],
  );
  return { ok: true, ...(await commentSettingOf(db, accountId)) };
}
