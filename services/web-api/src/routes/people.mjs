/** People to follow, Find's sections (2026-11-12) and the starter set
 *  (2026-11-13): `people.mjs` reads
 *  them. Signed in only, each its own read so Home's first paint and Find's
 *  first tab never wait on them, on one bucket of their own. */
import { checkRateLimit } from "@elixir-mcp/auth";
import { HOURLY_RATE_LIMIT } from "@elixir-mcp/tools/quota";
import { normalizeTag } from "@elixir-mcp/contracts";
import { followedMoment } from "../followed-moment.mjs";
import { json } from "../http.mjs";
import { peopleWithAvatars } from "../avatars.mjs";
import { blockedPeople, withoutBlocked } from "../blocks.mjs";
import { withPlayerConnections } from "../connections.mjs";
import { panel } from "./home.mjs";
import {
  battlePeople,
  clanPeople,
  findPeople,
  hideStarter,
  nearPeople,
  playerMap,
  starterSet,
  suggestedPeople,
} from "../people.mjs";

/** Three reads a visit at most, as Home's panels are counted. */
const PEOPLE_RATE_LIMIT = 3 * HOURLY_RATE_LIMIT;

export function peopleRoutes({
  resolveAccount,
  blocks = false,
  posts = false,
}) {
  const read = (name, fn) => async (db, event) => {
    const account = await resolveAccount(db, event);
    if (!account) return json(401, { error: "unauthenticated" });
    if (
      !(await checkRateLimit(db, {
        bucket: `people#${account.accountId}`,
        max: PEOPLE_RATE_LIMIT,
      }))
    )
      return json(429, { error: "rate_limited" });
    // Each listed player's profile image, one statement for the list.
    // Nobody in a block with the reader, either way, is suggested
    // (blocks.mjs, 2026-11-16).
    return json(
      200,
      await panel(name, async () =>
        peopleWithAvatars(
          db,
          withoutBlocked(
            await withPlayerConnections(
              db,
              account.accountId,
              await fn(db, account.accountId),
            ),
            await blockedPeople(db, account.accountId, { enabled: blocks }),
          ),
        ),
      ),
    );
  };
  return {
    "GET /api/me/people/suggested": read("people_suggested", suggestedPeople),
    "GET /api/me/people/battles": read("people_battles", battlePeople),
    "GET /api/me/people/clan": read("people_clan", clanPeople),
    // Find's Suggested (2026-11-13), the tab Find opens on.
    "GET /api/me/people/find": read("people_find", findPeople),
    // Home's starter set (2026-11-13): follows offered to an account that
    // follows few, never followed for it.
    "GET /api/me/people/starter": read("people_starter", starterSet),
    "GET /api/me/people/followed-moment": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (account.kind !== "person")
        return json(403, { error: "not_entitled" });
      const raw = (event.queryStringParameters?.players ?? "").split(",");
      if (raw.length > 50) return json(400, { error: "invalid_players" });
      let tags;
      try {
        tags = raw.map(normalizeTag);
      } catch {
        return json(400, { error: "invalid_players" });
      }
      if (
        !(await checkRateLimit(db, {
          bucket: `people#${account.accountId}`,
          max: PEOPLE_RATE_LIMIT,
        }))
      )
        return json(429, { error: "rate_limited" });
      return json(
        200,
        await followedMoment(db, account.accountId, tags, {
          comments: blocks,
          posts,
        }),
      );
    },
    // Find's Near you and the player map (#768): signed-in people only.
    "GET /api/me/people/near": read("people_near", nearPeople),
    "GET /api/me/player-map": read("player_map", playerMap),
    // Its quiet "Not now": off Home's top for 30 days.
    "POST /api/me/people/starter/hide": async (db, event) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      return json(200, await hideStarter(db, account.accountId));
    },
  };
}
