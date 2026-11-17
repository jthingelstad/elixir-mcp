import { checkRateLimit } from "@elixir-mcp/auth";
import { subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { readVisiblePost } from "@elixir-mcp/posts";
import { DISCLAIMER } from "@elixir-mcp/contracts";
import { sharePath } from "@elixir-mcp/sharing/paths";
import { createItemShare, readSharedItem } from "../timeline-sharing.mjs";
import { withCheers } from "../cheers.mjs";
import { withComments } from "../comments.mjs";
import { json } from "../http.mjs";
import { namedShell } from "./battle.mjs";

const PRIVATE = { "cache-control": "private, no-store" };
const PUBLIC = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
};
const gone = () => json(404, { error: "not_found" }, PUBLIC);

/** All public reads require an issued 120-bit capability. There is no
 * anonymous listing, arbitrary id lookup, history, or source-data route.
 */
export function itemSharingRoutes({
  resolveAccount,
  siteShell,
  posts = false,
  comments = false,
  shareImage,
}) {
  const person = async (db, event, write = false) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    return account?.kind === "person" ? account : null;
  };
  const read = (db, id) => readSharedItem(db, id, { plain: posts });
  return {
    "POST /api/me/item-shares": async (db, event, body) => {
      const account = await person(db, event, true);
      if (!account) return json(401, { error: "unauthenticated" }, PRIVATE);
      if (
        !(await checkRateLimit(db, {
          bucket: `itemshare#${account.accountId}`,
          max: 120,
        }))
      )
        return json(
          429,
          { error: "rate_limited" },
          { ...PRIVATE, "retry-after": "600" },
        );
      const shared = await createItemShare(db, account.accountId, body, {
        plain: posts,
      });
      return shared ? json(200, shared, PRIVATE) : gone();
    },
    "GET /api/me/post/*": async (db, event) => {
      const account = await person(db, event);
      if (!account) return json(401, { error: "unauthenticated" }, PRIVATE);
      const subjects = await subjectsFor(db, account.accountId);
      const item = await readVisiblePost(
        db,
        account.accountId,
        event.pathParam,
        { subjects, plain: posts },
      );
      if (!item) return gone();
      const [withReactions] = await withCheers(db, [item], account.accountId);
      const [full] = await withComments(
        db,
        [withReactions],
        account.accountId,
        { enabled: comments },
      );
      return json(200, { item: full }, PRIVATE);
    },
    "GET /api/public/shared-items/*": async (db, event) => {
      const shared = await read(db, event.pathParam);
      return shared
        ? json(200, { ...shared, disclaimer: DISCLAIMER }, PUBLIC)
        : gone();
    },
    "GET /share/*": async (db, event) => {
      const ref = String(event.pathParam ?? "");
      const picture = ref.endsWith(".png");
      const id = picture ? ref.slice(0, -4) : ref;
      if (!sharePath(id) || (!picture && !siteShell)) return gone();
      const shared = await read(db, id);
      if (!shared) return gone();
      if (picture) {
        if (!shareImage) return json(503, { error: "unavailable" }, PUBLIC);
        const bytes = await shareImage({ shared: true, ...shared });
        return {
          statusCode: 200,
          headers: { ...PUBLIC, "content-type": "image/png" },
          body: Buffer.from(bytes).toString("base64"),
          isBase64Encoded: true,
        };
      }
      const who = shared.item.subjects?.find((s) => s.kind === "player")?.name;
      const title =
        shared.item.kind === "post"
          ? `${who ?? "A player"} ${shared.item.post.question ? "asked a question" : "posted"}`
          : who
            ? `${who} on Elixir`
            : "A Timeline update on Elixir";
      const description = String(
        shared.item.post?.text ?? shared.item.text ?? "",
      ).slice(0, 240);
      const html = namedShell(
        await siteShell(),
        {},
        {
          title,
          description,
          url: shared.url,
          image: `${shared.url}.png`,
        },
      ).replace('content="noindex"', 'content="noindex, nofollow, noarchive"');
      return {
        statusCode: 200,
        headers: { ...PUBLIC, "content-type": "text/html; charset=utf-8" },
        body: html,
      };
    },
  };
}
