/**
 * The tier census ({tier_census: {dry_run: true}}), a read.
 *
 * Since 2026-10-12 Leader and Family are earned in the game and read on
 * every request (#530, #539; `tierSql` in contracts roles.ts): Leader is a
 * verified player leading or co-leading a clan the account tracks, Family
 * an active collector. A stored `leader` or `family` is a hand grant from
 * before, and no longer counts. This answers, for every person:
 *
 *   - the stored role and the tier read now, and the ground for it
 *   - which accounts the change moved (`changed`: stored grant higher or
 *     lower than the tier now read), with the direction
 *   - who holds more than their tier's ceilings (players, activity and
 *     comprehensive clans, pooled with their active agents): nobody is
 *     cut; the live count refuses only the next add
 *
 * Accounts are named by an id prefix and public id, never an address.
 * A read-only session; `dry_run: true` is the only shape it takes (the
 * name keeps the ops lane's census convention), and it writes nothing.
 */

import pg from "pg";
import {
  ROLE_ORDER,
  roleQuotas,
  tierSql,
  familyGroundSql,
  leaderGroundSql,
} from "@elixir-mcp/contracts";
import { poolLimits, pooledUsage } from "@elixir-mcp/claims";

export async function tierCensusOp(databaseUrl, spec = {}) {
  if (spec?.dry_run !== true)
    return { error: "tier_census is a read: pass {dry_run: true}" };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set default_transaction_read_only = on");
    const { rows } = await db.query(
      `select a.account_id, a.public_id, a.status, a.is_owner,
              a.role as stored_role, ${tierSql("a")} as tier,
              ${familyGroundSql("a")} as family_ground,
              ${leaderGroundSql("a")} as leader_ground,
              a.max_player_recordings as override
         from account a
        where coalesce(a.kind, 'person') = 'person'
        order by a.created_at`,
    );
    const rank = (r) => ROLE_ORDER.indexOf(r);
    const ref = (r) => ({
      account: String(r.account_id).slice(0, 8),
      public_id: r.public_id ?? null,
      status: r.status,
    });
    const byTier = {};
    const byStored = {};
    const changed = [];
    const over = [];
    for (const r of rows) {
      byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
      byStored[r.stored_role] = (byStored[r.stored_role] ?? 0) + 1;
      const ground = r.family_ground
        ? "active_collector"
        : r.leader_ground
          ? "verified_leader"
          : null;
      if (r.tier !== r.stored_role)
        changed.push({
          ...ref(r),
          stored_role: r.stored_role,
          tier: r.tier,
          direction: rank(r.tier) > rank(r.stored_role) ? "up" : "down",
          hand_grant_lost:
            (r.stored_role === "leader" || r.stored_role === "family") &&
            rank(r.tier) < rank(r.stored_role),
          ground,
        });
      if (r.status !== "approved") continue;
      const limits = poolLimits({
        role: r.tier,
        is_owner: r.is_owner,
        override: r.override,
      });
      if (limits.exempt) continue;
      const used = await pooledUsage(db, r.account_id);
      const excess = {
        players:
          used.players_used > limits.player_slots
            ? { used: used.players_used, limit: limits.player_slots }
            : null,
        activity_clans:
          used.activity_used > limits.activity
            ? { used: used.activity_used, limit: limits.activity }
            : null,
        comprehensive_clans:
          used.comprehensive_used > limits.comprehensive
            ? { used: used.comprehensive_used, limit: limits.comprehensive }
            : null,
      };
      if (Object.values(excess).some(Boolean))
        over.push({ ...ref(r), tier: r.tier, ground, ...excess });
    }
    return {
      dry_run: true,
      persons: rows.length,
      by_tier: byTier,
      by_stored_role: byStored,
      grounds: {
        active_collector: rows.filter((r) => r.family_ground).length,
        verified_leader: rows.filter((r) => r.leader_ground).length,
      },
      changed,
      hand_grants_lost: changed.filter((c) => c.hand_grant_lost).length,
      over_ceiling: over,
      ceilings: Object.fromEntries(
        ["member", "leader", "family"].map((t) => {
          const q = roleQuotas(t);
          return [
            t,
            {
              players: q.player_slots,
              activity_clans: q.activity_clans,
              comprehensive_clans: q.comprehensive_clans,
            },
          ];
        }),
      ),
    };
  } finally {
    await db.end();
  }
}
