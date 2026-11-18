import { checkRateLimit } from "@elixir-mcp/auth";
import { subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { resolveMemberItem } from "../timeline-items.mjs";
import { readItemRef } from "../timeline-item-ref.mjs";
import { withTimelineSocial } from "../timeline-social.mjs";
import { json } from "../http.mjs";

const PRIVATE = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
};
export function timelineItemRoutes({
  resolveAccount,
  posts = false,
  comments = false,
}) {
  return {
    "GET /api/me/timeline-items/*": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" }, PRIVATE);
      if (account.kind !== "person")
        return json(403, { error: "not_entitled" }, PRIVATE);
      if (
        !(await checkRateLimit(db, {
          bucket: `timelineitem#${account.accountId}`,
          max: 240,
        }))
      )
        return json(
          429,
          { error: "rate_limited" },
          { ...PRIVATE, "retry-after": "600" },
        );
      const item = await resolveMemberItem(db, {
        accountId: account.accountId,
        itemId: event.pathParam,
        item: readItemRef(event.queryStringParameters?.item_ref),
        subjects: await subjectsFor(db, account.accountId),
        posts,
      });
      if (!item) return json(404, { error: "not_found" }, PRIVATE);
      const [full] = await withTimelineSocial(db, [item], account.accountId, {
        comments,
      });
      return json(200, { item: full }, PRIVATE);
    },
  };
}
