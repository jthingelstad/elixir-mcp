/** Your own battles, read now (2026-11-14; own-refresh.mjs has the rules).
 *
 *  `POST /api/me/refresh` asks the live lane for your own verified
 *  players' battle logs: the contract header required. Every limit's
 *  refusal is a 200 with `queued: false`, never an error the person
 *  sees.
 *
 *  `GET /api/me/refresh` is the page's cheap follow-up: whether the reads
 *  it asked for have landed, and whether Home's stored week has them.
 *
 *  With `player_tag` (the body's on POST, the query's on GET), both ask
 *  about that one player instead: the player page's button, which reaches
 *  anyone Elixir knows, one read at a time (own-refresh.mjs, refreshPlayer). */
import { checkRateLimit } from "@elixir-mcp/auth";
import { normalizeTag } from "@elixir-mcp/contracts";
import { json } from "../http.mjs";
import {
  playerStatus,
  refreshOwn,
  refreshPlayer,
  refreshStatus,
} from "../own-refresh.mjs";

/** Asks in an hour, past which the answer is `queued: false` without a
 *  read of anything: the floor already bounds what an ask can spend. */
export const REFRESH_ASKS_PER_HOUR = 60;
/** Follow-up reads in an hour: a few after each ask. */
export const REFRESH_READS_PER_HOUR = 240;

const unauthenticated = () => json(401, { error: "unauthenticated" });
export function refreshRoutes({ resolveAccount, live, wake = null }) {
  const person = async (db, event, write) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account) return { refused: unauthenticated() };
    return { account };
  };

  /** The asked player's tag: absent is undefined, a bad one null. */
  const askedTag = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    try {
      return normalizeTag(value);
    } catch {
      return null;
    }
  };
  const badTag = () => json(400, { error: "invalid_tag" });

  return {
    "POST /api/me/refresh": async (db, event, body = {}) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      const tag = askedTag(body?.player_tag);
      if (tag === null) return badTag();
      if (
        !(await checkRateLimit(db, {
          bucket: `refresh#${account.accountId}`,
          max: REFRESH_ASKS_PER_HOUR,
        }))
      )
        return json(200, { queued: false, players: [] });
      return json(
        200,
        tag
          ? await refreshPlayer(db, live, account, tag)
          : await refreshOwn(db, live, account),
      );
    },

    "GET /api/me/refresh": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      const tag = askedTag(event.queryStringParameters?.player_tag);
      if (tag === null) return badTag();
      if (
        !(await checkRateLimit(db, {
          bucket: `refresh-read#${account.accountId}`,
          max: REFRESH_READS_PER_HOUR,
        }))
      )
        return json(429, { error: "rate_limited" }, { "retry-after": "600" });
      return json(
        200,
        tag
          ? await playerStatus(db, tag)
          : await refreshStatus(db, account.accountId, { wake }),
      );
    },
  };
}
