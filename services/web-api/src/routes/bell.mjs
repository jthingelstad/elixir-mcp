/** The bell (2026-11-12): `GET /api/me/bell` reads its reactions, followers
 *  and feedback answers with how many are new; `PUT /api/me/bell/seen` moves
 *  the account's seen marker when the bell is opened (the contract header
 *  required). A person's only: an agent is refused, and no agent console
 *  reaches either (AGENT_SCOPED_ROUTES does not list them). Actions waiting
 *  stay Clan's own read, `/api/me/home/needs`. */
import { checkRateLimit } from "@elixir-mcp/auth";
import { json } from "../http.mjs";
import { BELL_READS_PER_HOUR, markBellSeen, readBell } from "../bell.mjs";

const notEntitled = () =>
  json(403, {
    error: "not_entitled",
    message: "The bell is a person's own; an agent has none.",
  });

export function bellRoutes({ resolveAccount, wake = null }) {
  const person = async (db, event, write) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account) return { refused: json(401, { error: "unauthenticated" }) };
    if (account.kind === "agent") return { refused: notEntitled() };
    return { account };
  };

  return {
    "GET /api/me/bell": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      if (
        !(await checkRateLimit(db, {
          bucket: `bell#${account.accountId}`,
          max: BELL_READS_PER_HOUR,
        }))
      )
        return json(429, { error: "rate_limited" }, { "retry-after": "600" });
      const started = Date.now();
      const perf = {};
      const bell = await readBell(db, account.accountId, { wake, perf });
      // Like Home's panels: how long, and whether the week was stored.
      console.info(
        JSON.stringify({
          at: "home_panel",
          panel: "bell",
          ms: Date.now() - started,
          stored: perf.stored ?? null,
          age_ms: perf.age_ms ?? null,
        }),
      );
      return json(200, bell);
    },

    "PUT /api/me/bell/seen": async (db, event) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      return json(200, { seen_at: await markBellSeen(db, account.accountId) });
    },
  };
}
