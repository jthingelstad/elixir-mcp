/** Private pair facts on a followed friend's page. Current verification
 * and visible following are checked on every summary and page request. */
import { checkRateLimit } from "@elixir-mcp/auth";
import { visibleFriendSql } from "@elixir-mcp/claims";
import { MODE_GROUPS, normalizeTag } from "@elixir-mcp/contracts";
import {
  pairCursor,
  playerPairSummary,
  playerPairBattles,
} from "@elixir-mcp/record/player-pair";
import { json } from "../http.mjs";

const DAY = 86400000;
const tag = (value) => {
  try {
    return normalizeTag(String(value ?? ""));
  } catch {
    return null;
  }
};
export function playerPairRoutes({ resolveAccount }) {
  return {
    "GET /api/me/player-pair": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (account.kind !== "person")
        return json(403, { error: "not_entitled" });
      const q = event.queryStringParameters ?? {};
      const friendTag = tag(q.tag);
      if (!friendTag) return json(400, { error: "invalid_tag" });
      if (
        !(await checkRateLimit(db, {
          bucket: `playerpair#${account.accountId}`,
          max: 240,
        }))
      )
        return json(429, { error: "rate_limited" });
      const following = await db.query(
        `select 1 from claim c where c.account_id=$1 and c.player_tag=$2 and ${visibleFriendSql("c")}`,
        [account.accountId, friendTag],
      );
      if (!following.rows.length) return json(404, { error: "not_found" });
      const { rows: own } = await db.query(
        `select c.player_tag as tag,p.name from claim c join player p on p.player_tag=c.player_tag
      where c.account_id=$1 and c.status='verified' and(c.is_primary or c.relationship in('primary','alt'))
      order by c.is_primary desc,c.player_tag`,
        [account.accountId],
      );
      if (!own.length)
        return q.side !== undefined
          ? json(403, { error: "verification_required" })
          : json(200, { state: "verify", own_players: [], modes: [] });
      const selected = q.as ? own.find((p) => p.tag === tag(q.as)) : own[0];
      if (!selected) return json(404, { error: "not_found" });
      const toMs = Date.now();
      const window = { fromMs: toMs - 30 * DAY, toMs };
      const ask = { ...window, playerTag: selected.tag, friendTag };
      if (q.side !== undefined) {
        if (
          !["teamed", "against"].includes(q.side) ||
          !MODE_GROUPS.includes(q.mode)
        )
          return json(400, { error: "invalid_filter" });
        const before = q.before ? pairCursor(q.before) : null;
        if (q.before && !before) return json(400, { error: "invalid_cursor" });
        return json(
          200,
          await playerPairBattles(db, {
            ...ask,
            mode: q.mode,
            side: q.side,
            before,
          }),
        );
      }
      return json(200, {
        state: "ready",
        own_players: own,
        selected_player: selected.tag,
        window: {
          from: new Date(window.fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
        },
        modes: await playerPairSummary(db, ask),
      });
    },
  };
}
