/** Your own battles, read now (2026-11-14; own-refresh.mjs has the rules).
 *
 *  `POST /api/me/refresh` asks the live lane for your own verified
 *  players' battle logs: the contract header required, a person only (an
 *  agent is refused, and no agent console reaches it: AGENT_SCOPED_ROUTES
 *  does not list it). Every limit's refusal is a 200 with `queued: false`,
 *  never an error the person sees.
 *
 *  `GET /api/me/refresh` is the page's cheap follow-up: whether the reads
 *  it asked for have landed, and whether Home's stored week has them. */
import { checkRateLimit } from "@elixir-mcp/auth";
import { json } from "../http.mjs";
import { refreshOwn, refreshStatus } from "../own-refresh.mjs";

/** Asks in an hour, past which the answer is `queued: false` without a
 *  read of anything: the floor already bounds what an ask can spend. */
export const REFRESH_ASKS_PER_HOUR = 60;
/** Follow-up reads in an hour: a few after each ask. */
export const REFRESH_READS_PER_HOUR = 240;

const unauthenticated = () => json(401, { error: "unauthenticated" });
const notEntitled = () =>
  json(403, {
    error: "not_entitled",
    message:
      "Reading your own battles now is a person's own; an agent has none.",
  });

export function refreshRoutes({ resolveAccount, live, wake = null }) {
  const person = async (db, event, write) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account) return { refused: unauthenticated() };
    if (account.kind === "agent") return { refused: notEntitled() };
    return { account };
  };

  return {
    "POST /api/me/refresh": async (db, event) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (
        !(await checkRateLimit(db, {
          bucket: `refresh#${account.accountId}`,
          max: REFRESH_ASKS_PER_HOUR,
        }))
      )
        return json(200, { queued: false, players: [] });
      return json(200, await refreshOwn(db, live, account));
    },

    "GET /api/me/refresh": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      if (
        !(await checkRateLimit(db, {
          bucket: `refresh-read#${account.accountId}`,
          max: REFRESH_READS_PER_HOUR,
        }))
      )
        return json(429, { error: "rate_limited" }, { "retry-after": "600" });
      return json(200, await refreshStatus(db, account.accountId, { wake }));
    },
  };
}
