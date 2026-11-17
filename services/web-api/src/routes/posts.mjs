/** Posts (2026-11-17): posts.mjs and battle-posts.mjs do the work.
 *
 *  - `GET /api/me/posts?player=<tag>` or `?account=<page id>` or
 *    `?mine=1`: the posts the reader may see by one player or account,
 *    newest first. `?battle=<id or link>`: the battle page's panel, the
 *    reader's own posts about it and the players they may post it as.
 *  - `POST /api/me/posts` `{ text, question?, deck_link?, cards? }`, or
 *    `{ battle, player_tag?, text? }` for a post about a battle: write
 *    one, after the check (comment-check.mjs, the post policy).
 *  - `PUT /api/me/posts/<id>` `{ text }`: the author changes the words.
 *  - `DELETE /api/me/posts/<id>`: the author's own goes at once.
 *  - `POST /api/me/post-shares` `{ id }`: a post about a battle gets its
 *    public link, /h/<share id> (routes/shared-post.mjs serves it).
 *  - `POST /api/me/post-discord` `{ id }`: a shared post about a battle,
 *    once, in its player's clan's Discord (#767).
 *  - `POST /api/me/post-reports` `{ id, reason }`.
 *  - Admin: `POST /api/admin/posts/remove` `{ id }`,
 *    `POST /api/admin/posts/dismiss` `{ id }`; the queue rides
 *    `GET /api/admin/comments` (routes/comments.mjs).
 *
 *  A person's only: an agent is refused, and no agent console reaches
 *  them (AGENT_SCOPED_ROUTES does not list them). A post about nothing in
 *  the record needs posts on (the stack's PostsEnabled with
 *  CommentsEnabled; else 404 `posts_off`); a post about a battle, what a
 *  highlight was, works either way (0291). Blocking from a post rides
 *  `POST /api/me/blocks` `{ post_id }`. */
import { checkRateLimit } from "@elixir-mcp/auth";
import { accountOfPage } from "@elixir-mcp/claims";
import { normalizeTag } from "@elixir-mcp/contracts";
import { subjectsFor } from "@elixir-mcp/tools/activity/entries";
import {
  deletePost,
  dismissPostReports,
  editPost,
  ownPostsOn,
  postsBy,
  readPostInput,
  removePost,
  reportPost,
  visiblePost,
  writePost,
} from "../posts.mjs";
import { battleFor, sharePost } from "../battle-posts.mjs";
import { factAfter } from "../passport-hooks.mjs";
import { json } from "../http.mjs";
import { withCheers } from "../cheers.mjs";
import { withComments } from "../comments.mjs";

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
        : error === "already_posted"
          ? 409
          : error === "not_found" || error === "posts_off"
            ? 404
            : 403;

/** Storyteller (#1015), after a post about a battle with words is stored
 *  or edited: one fact per distinct battle told with words. The post is
 *  the source and the canonical battle id the qualifier, so an edit, a
 *  second post as another player or a share adds nothing. Dated at the
 *  post's creation, as reconciliation dates it. */
async function storyFact(db, accountId, post) {
  const battleId = post?.post?.battle?.battle_id;
  if (!battleId || !/\S/.test(String(post.post.text ?? ""))) return;
  await factAfter(db, accountId, "storyteller", {
    stamp_id: "storyteller",
    source: `post:${post.post.id}`,
    battle_id: battleId,
    event_at: post.at,
  });
}

/** `posts`: `{ plain, check }` (posts.mjs writePost). `wake(db, post)`
 *  wakes the Discord syndication a post about a battle's player reaches
 *  (syndication wakeAfterPost); null without the outbox.
 *  `clanDiscord`: `{ state(db, accountId, id), post(db, accountId, id) }`,
 *  a shared post about a battle in its player's clan's Discord by its
 *  author (#767, syndication battle-post-share.mjs); null without the
 *  outbox. */
export function postsRoutes({
  resolveAccount,
  posts = null,
  wake = null,
  clanDiscord = null,
}) {
  const plain = posts?.plain === true;
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
  // After a post about a battle is written or its words change: the
  // syndication its player reaches, and the Storyteller stamp.
  const after = async (db, accountId, post, changed = true) => {
    if (!post?.post?.battle) return;
    if (changed && wake) await wake(db, { player_tag: post.subject_tag });
    await storyFact(db, accountId, post);
  };
  const withDiscord = async (db, accountId, items) => {
    for (const it of items)
      it.post.clan_discord = clanDiscord
        ? await clanDiscord.state(db, accountId, it.post.id)
        : null;
    return items;
  };

  return {
    "GET /api/me/posts": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      if (
        !(await checkRateLimit(db, {
          bucket: `postread#${account.accountId}`,
          max: POST_READS_PER_HOUR,
        }))
      )
        return limited();
      const q = event.queryStringParameters ?? {};
      // The battle page's panel: may I post about this battle, as whom,
      // and what have I posted about it.
      if (q.battle) {
        const on = await battleFor(db, account.accountId, String(q.battle));
        if (on.error) return json(404, on);
        const own = await ownPostsOn(db, account.accountId, on.battle_id);
        return json(200, {
          battle_id: on.battle_id,
          can_post_as: on.players,
          posts: await withDiscord(db, account.accountId, own),
        });
      }
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
      // Each with its cheers and comments, as the Timeline draws it.
      const items = await postsBy(db, account.accountId, {
        subjects,
        plain,
        ...by,
      });
      return json(200, {
        posts: await withComments(
          db,
          await withCheers(db, items, account.accountId),
          account.accountId,
          { enabled: Boolean(posts?.check) },
        ),
      });
    },

    "POST /api/me/posts": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      const input = readPostInput(body);
      if (input.error) return json(postStatus(input.error), input);
      if (!input.battle && !plain) return off();
      const out = await writePost(db, account, input, posts);
      if (!out.ok) return json(postStatus(out.error), out);
      await after(db, account.accountId, out.post);
      return json(201, { post: out.post });
    },

    "PUT /api/me/posts/*": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      const out = await editPost(
        db,
        account,
        event.pathParam,
        body?.text,
        posts,
      );
      if (!out.ok) return json(postStatus(out.error), out);
      await after(db, account.accountId, out.post, out.changed);
      return json(200, { post: out.post, changed: out.changed });
    },

    "DELETE /api/me/posts/*": async (db, event) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      const out = await deletePost(db, account, event.pathParam);
      return out.error ? notFound() : json(200, out);
    },

    "POST /api/me/post-shares": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      const out = await sharePost(db, account.accountId, body?.id);
      return out.error ? notFound() : json(200, { share_url: out.share_url });
    },

    // The author posts a shared post about a battle in its player's
    // clan's Discord, once, where the clan's leaders allow it (#767).
    "POST /api/me/post-discord": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!/^[1-9][0-9]{0,18}$/.test(String(body?.id ?? "")))
        return notFound();
      if (!clanDiscord)
        return json(503, {
          error: "unavailable",
          message: "Discord posting is not set up.",
        });
      const r = await clanDiscord.post(db, account.accountId, String(body.id));
      return r.error
        ? json(r.status, { error: r.error, message: r.message })
        : json(r.status, { posted_at: r.posted_at, already: r.already });
    },

    "POST /api/me/post-reports": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
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
        // Only a post the reporter may read now (their Timeline, a
        // player's page, or their clan's Feed); ids are sequential.
        async (row) =>
          (await visiblePost(db, account.accountId, row.item_id, subjects, {
            plain,
          })) !== null,
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
