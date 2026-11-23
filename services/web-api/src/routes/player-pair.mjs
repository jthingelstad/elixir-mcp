/** Your games with another player: the Together tab on any player's page
 * but your own (2026-11-23, was a followed friend's only). It reads only
 * your own verified players' battles with them, so it needs no follow;
 * a block either way with the player's verified owner closes it, as one
 * reads like any other association between you. Current verification and
 * the block are checked on every summary and page request. */
import { checkRateLimit } from "@elixir-mcp/auth";
import { ownerBlockedSql } from "@elixir-mcp/claims";
import { MODE_GROUPS, normalizeTag } from "@elixir-mcp/contracts";
import {
  PAIR_DAYS,
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
      // Not your own player, and no block either way with its owner. The
      // same 404 for both, so a block the other way is never said.
      const { rows: gate } = await db.query(
        `select exists (select 1 from claim c where c.account_id=$1 and c.player_tag=$2
                  and (c.is_primary or c.relationship in ('primary','alt'))) as own,
                ${ownerBlockedSql("$1::uuid", "$2")} as blocked`,
        [account.accountId, friendTag],
      );
      if (gate[0].own || gate[0].blocked)
        return json(404, { error: "not_found" });
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
      const window = { fromMs: toMs - PAIR_DAYS * DAY, toMs };
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
        modes: await playerPairSummary(db, {
          ...ask,
          timezone: account.timezone ?? "UTC",
        }),
      });
    },
  };
}
