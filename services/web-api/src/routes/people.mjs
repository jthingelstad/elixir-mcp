/** People to follow, Find's sections (2026-11-12) and the starter set
 *  (2026-11-13): `people.mjs` reads
 *  them. Signed in only, each its own read so Home's first paint and Find's
 *  first tab never wait on them, on one bucket of their own. A person's
 *  only: an agent is refused, and no agent console reaches them
 *  (AGENT_SCOPED_ROUTES does not list them). */
import { checkRateLimit } from "@elixir-mcp/auth";
import { HOURLY_RATE_LIMIT } from "@elixir-mcp/tools/quota";
import { json } from "../http.mjs";
import { panel } from "./home.mjs";
import {
  battlePeople,
  clanPeople,
  hideStarter,
  starterSet,
  suggestedPeople,
} from "../people.mjs";

/** Three reads a visit at most, as Home's panels are counted. */
const PEOPLE_RATE_LIMIT = 3 * HOURLY_RATE_LIMIT;

export function peopleRoutes({ resolveAccount }) {
  const read = (name, fn) => async (db, event) => {
    const account = await resolveAccount(db, event);
    if (!account) return json(401, { error: "unauthenticated" });
    if (account.kind === "agent") return json(403, { error: "not_entitled" });
    if (
      !(await checkRateLimit(db, {
        bucket: `people#${account.accountId}`,
        max: PEOPLE_RATE_LIMIT,
      }))
    )
      return json(429, { error: "rate_limited" });
    return json(200, await panel(name, () => fn(db, account.accountId)));
  };
  return {
    "GET /api/me/people/suggested": read("people_suggested", suggestedPeople),
    "GET /api/me/people/battles": read("people_battles", battlePeople),
    "GET /api/me/people/clan": read("people_clan", clanPeople),
    // Home's starter set (2026-11-13): follows offered to an account that
    // follows few, never followed for it.
    "GET /api/me/people/starter": read("people_starter", starterSet),
    // Its quiet "Not now": off Home's top for 30 days.
    "POST /api/me/people/starter/hide": async (db, event) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      if (account.kind === "agent") return json(403, { error: "not_entitled" });
      return json(200, await hideStarter(db, account.accountId));
    },
  };
}
