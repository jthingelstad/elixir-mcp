/** Account pages and account follows (Jamie, 2026-11-15): account-page.mjs
 *  reads and writes them.
 *
 *  - `GET /api/accounts/<page-id>`: an account's page, for any signed-in
 *    member, one charge on the hourly bucket the player page uses.
 *  - `POST /api/me/account-follows` `{id}`: follow an account and each of
 *    its Verified players (linked follows, claims/linked.mjs).
 *  - `DELETE /api/me/account-follows/<page-id>`: stop following it and
 *    them.
 *
 *  A person's only: an agent is refused, and no agent console reaches
 *  them (AGENT_SCOPED_ROUTES does not list them). */
import { checkRateLimit } from "@elixir-mcp/auth";
import { HOURLY_RATE_LIMIT } from "@elixir-mcp/tools/quota";
import {
  ACCOUNT_FOLLOW_MAX,
  followAccount,
  readAccountPage,
  unfollowAccount,
} from "../account-page.mjs";
import { json } from "../http.mjs";
import { followPlan } from "./player.mjs";

const notFound = () =>
  json(404, { error: "not_found", message: "No Elixir account has that id." });

export function accountsRoutes({ resolveAccount }) {
  const person = async (db, event, { write = false } = {}) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account) return { refused: json(401, { error: "unauthenticated" }) };
    if (account.kind !== "person")
      return { refused: json(403, { error: "not_entitled" }) };
    if (
      !(await checkRateLimit(db, {
        bucket: `mcp#${account.accountId}`,
        max: HOURLY_RATE_LIMIT,
      }))
    )
      return { refused: json(429, { error: "rate_limited" }) };
    return { account };
  };
  return {
    "GET /api/accounts/*": async (db, event) => {
      const { account, refused } = await person(db, event);
      if (refused) return refused;
      const page = await readAccountPage(db, account, event.pathParam);
      if (!page) return notFound();
      // What Follow would cost, said before the tap (Jamie, 2026-11-15):
      // the account's Verified players you don't follow yet.
      const plan =
        page.you.self || page.you.following
          ? null
          : await followPlan(db, account.accountId, page.you.to_follow);
      return json(200, { ...page, you: { ...page.you, plan } });
    },

    "POST /api/me/account-follows": async (db, event, body) => {
      const { account, refused } = await person(db, event, { write: true });
      if (refused) return refused;
      const out = await followAccount(db, account, body?.id);
      if (out.error === "not_found") return notFound();
      if (out.error === "self")
        return json(400, {
          error: "self",
          message: "That's your own account.",
        });
      if (out.error === "too_many")
        return json(429, {
          error: "too_many",
          message: `You can follow up to ${ACCOUNT_FOLLOW_MAX} accounts.`,
        });
      return json(200, out);
    },

    "DELETE /api/me/account-follows/*": async (db, event) => {
      const { account, refused } = await person(db, event, { write: true });
      if (refused) return refused;
      const out = await unfollowAccount(db, account, event.pathParam);
      return out.error ? notFound() : json(200, out);
    },
  };
}
