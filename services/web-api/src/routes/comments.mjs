/** Comments, blocks and reports (2026-11-16): comments.mjs and
 *  @elixir-mcp/claims blocks.mjs do the work.
 *
 *  - `GET /api/me/comments?item=<id>&subjects=<tag,…>`: one item's
 *    comments, for an actual recorded item the member may read.
 *  - `POST /api/me/comments` `{ item_id, subjects, text }`: post one,
 *    after the check (comment-check.mjs).
 *  - `DELETE /api/me/comments/<id>`: the author's own goes; the item
 *    owner's removal keeps it for admins.
 *  - `POST /api/me/comment-reports` `{ id, reason }`.
 *  - `GET` / `PUT /api/me/comment-setting` `{ who }`.
 *  - `GET /api/me/blocks`, `POST /api/me/blocks` `{ account_id }` or
 *    `{ player_tag }` or `{ comment_id }`, `DELETE /api/me/blocks/<page id>`.
 *  - Admin: `GET /api/admin/comments`, `POST /api/admin/comments/remove`
 *    `{ id }`, `POST /api/admin/comments/dismiss` `{ id }`,
 *    `POST /api/admin/comment-suspensions` `{ account_id, days }`.
 *
 *  A person's only: an agent is refused, and no agent console reaches
 *  them (AGENT_SCOPED_ROUTES does not list them). With comments off
 *  (the stack's CommentsEnabled false) every write here answers 404
 *  `comments_off` and the reads answer nothing. */
import { checkRateLimit } from "@elixir-mcp/auth";
import {
  accountOfPage,
  blockAccount,
  listBlocks,
  unblockAccount,
  verifierOf,
} from "@elixir-mcp/claims";
import { normalizeTag } from "@elixir-mcp/contracts";
import { ITEM_ID_RE } from "@elixir-mcp/tools/activity/cheers";
import { subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { ownFeedItem } from "../cheers.mjs";
import { readItemRef } from "../timeline-item-ref.mjs";
import {
  commentQueue,
  commentSettingOf,
  commentsOnItem,
  readCommentCursor,
  validCommentId,
  deleteComment,
  dismissReports,
  postComment,
  removeComment,
  reportComment,
  setCommentSetting,
  suspendCommenting,
} from "../comments.mjs";
import { postQueue } from "../posts.mjs";
import { json } from "../http.mjs";

/** Item reads one person may make in an hour: each rebuilds a slice of
 *  their feed, as a page's cheers read does. */
const COMMENT_READS_PER_HOUR = 240;
/** Block and unblock taps in an hour. */
const BLOCKS_PER_HOUR = 60;
/** Reports in an hour. */
const REPORTS_PER_HOUR = 30;

const off = () =>
  json(404, { error: "comments_off", message: "Comments aren't on yet." });
const notFound = () => json(404, { error: "not_found" });
const limited = () =>
  json(
    429,
    { error: "rate_limited", message: "Too many in an hour. Try again later." },
    { "retry-after": "600" },
  );

/** Subject tags a request names (at most eight; anything not a tag is
 *  dropped). */
function tagsOf(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw ?? "")
        .split(",")
        .filter(Boolean);
  const tags = [];
  for (const t of list.slice(0, 8)) {
    try {
      tags.push(normalizeTag(String(t)));
    } catch {
      // Not a tag: it names nothing the account follows.
    }
  }
  return tags;
}

export function commentsRoutes({
  resolveAccount,
  comments = null,
  posts = false,
}) {
  const enabled = comments?.enabled === true;
  const person = async (db, event, write) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account) return { refused: json(401, { error: "unauthenticated" }) };
    if (account.kind !== "person")
      return { refused: json(403, { error: "not_entitled" }) };
    return { account };
  };
  const admin = async (db, event, write) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account?.isAdmin)
      return { refused: json(403, { error: "not_entitled" }) };
    return { account };
  };
  const feedItem = async (db, account, itemId, tags, item = null) =>
    ITEM_ID_RE.test(itemId)
      ? ownFeedItem(db, {
          accountId: account.accountId,
          itemId,
          tags,
          subjects: await subjectsFor(db, account.accountId),
          posts,
          item,
        })
      : null;

  return {
    "GET /api/me/comments": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      if (!enabled) return off();
      const q = event.queryStringParameters ?? {};
      if (
        !(await checkRateLimit(db, {
          bucket: `commentread#${account.accountId}`,
          max: COMMENT_READS_PER_HOUR,
        }))
      )
        return limited();
      const item = await feedItem(
        db,
        account,
        String(q.item ?? ""),
        tagsOf(q.subjects),
        q.item_ref === undefined ? null : (readItemRef(q.item_ref) ?? {}),
      );
      if (!item) return notFound();
      const before = q.before ? readCommentCursor(q.before) : null;
      if ((q.before && !before) || (q.around && !validCommentId(q.around)))
        return json(400, { error: "invalid_cursor" });
      return json(
        200,
        await commentsOnItem(db, account.accountId, item, {
          before,
          around: q.around ?? null,
        }),
      );
    },

    "POST /api/me/comments": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!enabled) return off();
      if (typeof body?.text !== "string")
        return json(400, {
          error: "bad_request",
          message: "Write something first.",
        });
      const item = await feedItem(
        db,
        account,
        String(body?.item_id ?? ""),
        tagsOf(body?.subjects),
        body?.item ?? null,
      );
      if (!item)
        return json(404, {
          error: "not_found",
          message: "That Timeline item is not available.",
        });
      const out = await postComment(db, account, item, body.text, {
        ...comments,
        // Moderation can outlast a membership, role, block or source
        // change. Re-admit the original locator immediately before write.
        canSee: async () =>
          (await feedItem(
            db,
            account,
            item.id,
            tagsOf(body?.subjects),
            body?.item ?? null,
          )) !== null,
      });
      if (out.ok) return json(201, { comment: out.comment });
      const status =
        out.error === "refused"
          ? 422
          : out.error === "rate_limited" || out.error === "cooldown"
            ? 429
            : out.error === "unavailable" || out.error === "paused"
              ? 503
              : 403;
      return json(status, out);
    },

    "DELETE /api/me/comments/*": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!enabled) return off();
      const out = await deleteComment(db, account, event.pathParam, {
        canSee: async (row) =>
          (await feedItem(
            db,
            account,
            row.item_id,
            [row.subject_tag, ...tagsOf(body?.subjects)],
            body?.item ?? null,
          )) !== null,
      });
      return out.error ? notFound() : json(200, out);
    },

    "POST /api/me/comment-reports": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!enabled) return off();
      if (
        !(await checkRateLimit(db, {
          bucket: `commentreport#${account.accountId}`,
          max: REPORTS_PER_HOUR,
        }))
      )
        return limited();
      const out = await reportComment(
        db,
        account,
        body?.id,
        String(body?.reason ?? ""),
        // The item's subjects as the reader's card names them (a clan as
        // well as its member), as the list and the post take them; a
        // comment stores its player alone (Codex on #1082). They only
        // narrow. A source locator is re-read under its current audience;
        // older subject-only callers keep the current-follow fallback.
        async (row) =>
          (await feedItem(
            db,
            account,
            row.item_id,
            [row.subject_tag, ...tagsOf(body?.subjects)],
            body?.item ?? null,
          )) !== null,
      );
      if (out.error === "invalid_reason")
        return json(400, { error: "invalid_reason" });
      return out.error ? notFound() : json(200, out);
    },

    "GET /api/me/comment-setting": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      if (!enabled) return off();
      return json(200, await commentSettingOf(db, account.accountId));
    },

    "PUT /api/me/comment-setting": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!enabled) return off();
      const out = await setCommentSetting(db, account.accountId, body?.who);
      return out.error ? json(400, out) : json(200, out);
    },

    "GET /api/me/blocks": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      if (!enabled) return off();
      return json(200, { blocks: await listBlocks(db, account.accountId) });
    },

    // Block: by an account's page id, a player (its verified owner) or a
    // comment (its author). Silent: nothing tells the blocked person.
    "POST /api/me/blocks": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!enabled) return off();
      if (
        !(await checkRateLimit(db, {
          bucket: `block#${account.accountId}`,
          max: BLOCKS_PER_HOUR,
        }))
      )
        return limited();
      let target = null;
      if (body?.account_id) target = await accountOfPage(db, body.account_id);
      else if (body?.player_tag) {
        try {
          target = await verifierOf(db, normalizeTag(String(body.player_tag)));
        } catch {
          target = null;
        }
      } else if (body?.post_id != null) {
        // A post's author (2026-11-17), as a comment's. A post about a
        // battle is drawn with posts off too (0292), so its author can be
        // blocked from it either way; a plain post's only while posts are
        // on (Codex on #1117).
        const id = String(body.post_id);
        if (/^[1-9][0-9]{0,18}$/.test(id)) {
          const { rows } = await db.query(
            `select account_id from account_post
              where post_id = $1::bigint
                and (battle_id is not null or $2::boolean)`,
            [id, posts === true],
          );
          target = rows[0]?.account_id ?? null;
        }
      } else if (body?.comment_id != null) {
        const id = String(body.comment_id);
        if (/^[1-9][0-9]{0,18}$/.test(id)) {
          const { rows } = await db.query(
            `select account_id from timeline_comment where comment_id = $1::bigint`,
            [id],
          );
          target = rows[0]?.account_id ?? null;
        }
      }
      const out = await blockAccount(db, account, target);
      if (out.error === "self")
        return json(400, { error: "self", message: "That's you." });
      if (out.error === "too_many")
        return json(429, {
          error: "too_many",
          message: "That's a lot of blocks.",
        });
      if (out.error) return notFound();
      return json(200, {
        ok: true,
        blocks: await listBlocks(db, account.accountId),
      });
    },

    "DELETE /api/me/blocks/*": async (db, event) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!enabled) return off();
      const target = await accountOfPage(db, event.pathParam);
      if (!target) return notFound();
      await unblockAccount(db, account, target);
      return json(200, {
        ok: true,
        blocks: await listBlocks(db, account.accountId),
      });
    },

    "GET /api/admin/comments": async (db, event) => {
      const { refused } = await admin(db, event, false);
      if (refused) return refused;
      const queue = await commentQueue(db);
      const cap = Number(comments?.capUsd ?? 0);
      // Paused now, by the check's own condition (comment-check.mjs): no
      // cap, or this month's spend at it. `paused_checks` counts the
      // checks the cap turned away (Codex on #1081).
      const paused = !(cap > 0) || Number(queue.month.usd) >= cap;
      return json(200, {
        enabled,
        posts_enabled: posts === true,
        cap_usd: comments?.capUsd ?? null,
        ...queue,
        // Posts reported or hidden for review (2026-11-17); their
        // refusals are among `refused`, `kind: "post"`.
        posts: await postQueue(db),
        month: {
          ...queue.month,
          paused,
          paused_checks: queue.month.paused,
        },
      });
    },

    "POST /api/admin/comments/remove": async (db, event, body) => {
      const { refused } = await admin(db, event, true);
      if (refused) return refused;
      const id = String(body?.id ?? "");
      if (!/^[1-9][0-9]{0,18}$/.test(id)) return notFound();
      const done = await removeComment(db, id, "admin");
      return done ? json(200, { ok: true }) : notFound();
    },

    "POST /api/admin/comments/dismiss": async (db, event, body) => {
      const { refused } = await admin(db, event, true);
      if (refused) return refused;
      const out = await dismissReports(db, body?.id);
      return out.error ? notFound() : json(200, out);
    },

    "POST /api/admin/comment-suspensions": async (db, event, body) => {
      const { refused } = await admin(db, event, true);
      if (refused) return refused;
      const target = await accountOfPage(db, body?.account_id);
      if (!target) return notFound();
      const out = await suspendCommenting(db, target, body?.days);
      return out.error ? json(400, out) : json(200, out);
    },
  };
}
