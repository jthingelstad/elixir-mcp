/**
 * Daily tool-call quota — librarian's split kept: known (approved)
 * accounts FAIL OPEN (a broken counter must never take the service down
 * for legitimate users); there is no anonymous spend on this surface
 * (the OAuth gate precedes it), so no fail-closed pool is needed here.
 */

import { roleQuotas } from "@elixir-mcp/contracts";

// Collector credits (Jamie, 2026-09-04): every 10 fetches your
// collectors perform adds 1 to your daily quota, capped at 4x base.
const CREDIT_DIVISOR = 10;
const CREDIT_CAP_MULTIPLE = 4;

export function makeQuota({ db, account }) {
  // Role default (contracts roles.ts), beaten by the per-account
  // override column when set. Admin role = unlimited, like the owner.
  const roleMax = roleQuotas(account.role).mcp_calls_per_day;
  const base = account.mcpDailyQuota ?? roleMax;
  return async function spendQuota() {
    if (account.isOwner || account.role === "admin" || base === Infinity)
      return { allowed: true, count: 0, max: Infinity };
    let max = base;
    try {
      const { rows } = await db.query(
        `select coalesce(sum(fetch_points), 0)::bigint as points
         from gateway where owner_account_id = $1 and status <> 'revoked'`,
        [account.accountId],
      );
      max = Math.min(
        base * CREDIT_CAP_MULTIPLE,
        base + Math.floor(Number(rows[0].points) / CREDIT_DIVISOR),
      );
    } catch {
      // Credits are a bonus; quota falls back to base if the read fails.
    }
    const day = new Date().toISOString().slice(0, 10);
    try {
      const { rows } = await db.query(
        `insert into rate_limit (bucket, window_start, count)
         values ($1, $2::date, 1)
         on conflict (bucket, window_start) do update set count = rate_limit.count + 1
         returning count`,
        [`mcpday#${account.accountId}`, day],
      );
      return { allowed: rows[0].count <= max, count: rows[0].count, max };
    } catch {
      return { allowed: true, count: 0, max }; // fail open for approved accounts
    }
  };
}
