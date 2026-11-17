/** Posts (2026-11-17): posts.mjs does the work.
 *
 *  - `GET /api/me/posts?player=<tag>` or `?account=<page id>` or
 *    `?mine=1`: the posts the reader may see by one player or account,
 *    newest first.
 *  - `POST /api/me/posts` `{ text, question?, deck_link?, cards? }`: write
 *    one, after the check (comment-check.mjs, the post policy).
 *  - `DELETE /api/me/posts/<id>`: the author's own goes at once.
 *  - `POST /api/me/post-reports` `{ id, reason }`.
 *  - Admin: `POST /api/admin/posts/remove` `{ id }`,
 *    `POST /api/admin/posts/dismiss` `{ id }`; the queue rides
 *    `GET /api/admin/comments` (routes/comments.mjs).
 *
 *  A person's only: an agent is refused, and no agent console reaches
 *  them (AGENT_SCOPED_ROUTES does not list them). With posts off (the
 *  stack's PostsEnabled or CommentsEnabled false) each answers 404
 *  `posts_off`. Blocking from a post rides `POST /api/me/blocks`
 *  `{ post_id }`. */
import { checkRateLimit } from "@elixir-mcp/auth";
import { accountOfPage } from "@elixir-mcp/claims";
import { normalizeTag } from "@elixir-mcp/contracts";
import { subjectsFor } from "@elixir-mcp/tools/activity/entries";
import {
  canSeePost,
  deletePost,
  inClanWith,
  dismissPostReports,
  postsBy,
  readPostInput,
  removePost,
  reportPost,
  writePost,
} from "../posts.mjs";
import { json } from "../http.mjs";

/** List reads one person may make in an hour (a player or account page
 *  opened). */
const POST_READS_PER_HOUR = 240;
/** Reports in an hour, as for comments. */
const REPORTS_PER_HOUR = 30;

const off = () =>
  json(404, { error: "posts_off", message: "Posts aren't on yet." });
const notFound = () => json(404, { error: "not_found" });
const limited = () =>
  json(
    429,
    { error: "rate_limited", message: "Too many in an hour. Try again later." },
    { "retry-after": "600" },
  );

/** The HTTP status for a refused write. */
export const postStatus = (error) =>
  error === "refused" || error === "bad_request"
    ? 422
    : error === "rate_limited" || error === "cooldown"
      ? 429
      : error === "unavailable" || error === "paused"
        ? 503
        : 403;

export function postsRoutes({ resolveAccount, posts = null }) {
  const enabled = posts?.enabled === true;
  const person = async (db, event, write) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account) return { refused: json(401, { error: "unauthenticated" }) };
    if (account.kind !== "person")
      return { refused: json(403, { error: "not_entitled" }) };
    return { account };
  };
  const admin = async (db, event) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: true,
    });
    if (!account?.isAdmin)
      return { refused: json(403, { error: "not_entitled" }) };
    return { account };
  };

  return {
    "GET /api/me/posts": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      if (!enabled) return off();
      if (
        !(await checkRateLimit(db, {
          bucket: `postread#${account.accountId}`,
          max: POST_READS_PER_HOUR,
        }))
      )
        return limited();
      const q = event.queryStringParameters ?? {};
      const subjects = await subjectsFor(db, account.accountId);
      let by;
      if (q.player) {
        try {
          by = { playerTag: normalizeTag(String(q.player)) };
        } catch {
          return notFound();
        }
      } else if (q.account) {
        const id = await accountOfPage(db, String(q.account));
        if (!id) return notFound();
        by = { accountId: id };
      } else if (q.mine) by = { accountId: account.accountId };
      else return notFound();
      return json(200, {
        posts: await postsBy(db, account.accountId, { subjects, ...by }),
      });
    },

    "POST /api/me/posts": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!enabled) return off();
      const input = readPostInput(body);
      if (input.error) return json(postStatus(input.error), input);
      const out = await writePost(db, account, input, posts);
      if (out.ok) return json(201, { post: out.post });
      return json(postStatus(out.error), out);
    },

    "DELETE /api/me/posts/*": async (db, event) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!enabled) return off();
      const out = await deletePost(db, account, event.pathParam);
      return out.error ? notFound() : json(200, out);
    },

    "POST /api/me/post-reports": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!enabled) return off();
      if (
        !(await checkRateLimit(db, {
          bucket: `postreport#${account.accountId}`,
          max: REPORTS_PER_HOUR,
        }))
      )
        return limited();
      const subjects = await subjectsFor(db, account.accountId);
      const out = await reportPost(
        db,
        account,
        body?.id,
        String(body?.reason ?? ""),
        // Only a post the reporter may read now (their Timeline, or their
        // clan's Feed); ids are sequential.
        async (row) =>
          (await canSeePost(db, account.accountId, row.item_id, subjects)) !==
            null || (await inClanWith(db, account.accountId, row.player_tag)),
      );
      if (out.error === "invalid_reason")
        return json(400, { error: "invalid_reason" });
      return out.error ? notFound() : json(200, out);
    },

    "POST /api/admin/posts/remove": async (db, event, body) => {
      const { refused } = await admin(db, event);
      if (refused) return refused;
      return (await removePost(db, body?.id))
        ? json(200, { ok: true })
        : notFound();
    },

    "POST /api/admin/posts/dismiss": async (db, event, body) => {
      const { refused } = await admin(db, event);
      if (refused) return refused;
      const out = await dismissPostReports(db, body?.id);
      return out.error ? notFound() : json(200, out);
    },
  };
}
