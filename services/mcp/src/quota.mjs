/**
 * Daily tool-call quota — librarian's split kept: known (approved)
 * accounts FAIL OPEN (a broken counter must never take the service down
 * for legitimate users); there is no anonymous spend on this surface
 * (the OAuth gate precedes it), so no fail-closed pool is needed here.
 *
 * The same spend is also DESCRIBED on every response (meta.quota): an
 * agent told to respect an invisible budget rations itself to near-zero
 * (feedback #17), so the counter is read for everyone - unlimited
 * accounts included - and only enforced for the capped tiers.
 */

import { roleQuotas } from "@elixir-mcp/contracts";
import { liveBudgetFor } from "./tools/shared.mjs";

// Collector credits (Jamie, 2026-09-04): every 10 fetches your
// collectors perform adds 1 to your daily quota, capped at 4x base.
const CREDIT_DIVISOR = 10;
const CREDIT_CAP_MULTIPLE = 4;

/** Next UTC midnight: when both daily buckets roll. */
function quotaResetsAt(now = new Date()) {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return next.toISOString();
}

export function makeQuota({ db, account }) {
  // WHOSE budget this call spends. An agent spends its owner's — that is the
  // deal that lets every clan leader have one without a tier gate — so the
  // counter, the ceiling and the collector credits all key on the owner. An
  // integration pays for itself from its own key. A person is both.
  // The fallback keeps pre-0053 shapes (and every test that builds an account
  // by hand) behaving exactly as before.
  const budget = account.budget ?? {
    accountId: account.accountId,
    role: account.role,
    override: account.mcpDailyQuota ?? null,
  };
  // Role default (contracts roles.ts), beaten by the per-account
  // override column when set. Admin role = unlimited, like the owner.
  const roleMax = roleQuotas(budget.role).mcp_calls_per_day;
  const base = budget.override ?? roleMax;
  const unlimited =
    budget.role === "owner" || budget.role === "admin" || base === Infinity;
  // The live lane's ceiling and bucket are spendLiveQuota's exactly (one
  // definition, tools/shared.mjs): the OWNER's budget for an agent.
  const live = liveBudgetFor(account);
  const liveMax = live.cap;
  const day = () => new Date().toISOString().slice(0, 10);

  async function liveUsed() {
    try {
      const { rows } = await db.query(
        `select count from rate_limit where bucket = $1 and window_start = $2::date`,
        [live.bucket, day()],
      );
      return Number(rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  async function spendQuota() {
    let max = base;
    if (!unlimited) {
      try {
        const { rows } = await db.query(
          `select coalesce(sum(fetch_points), 0)::bigint as points
           from gateway where owner_account_id = $1 and status <> 'revoked'`,
          [budget.accountId],
        );
        max = Math.min(
          base * CREDIT_CAP_MULTIPLE,
          base + Math.floor(Number(rows[0].points) / CREDIT_DIVISOR),
        );
      } catch {
        // Credits are a bonus; quota falls back to base if the read fails.
      }
    }
    let count = 0;
    try {
      const { rows } = await db.query(
        `insert into rate_limit (bucket, window_start, count)
         values ($1, $2::date, 1)
         on conflict (bucket, window_start) do update set count = rate_limit.count + 1
         returning count`,
        [`mcpday#${budget.accountId}`, day()],
      );
      count = Number(rows[0].count);
    } catch {
      // fail open for approved accounts
      return {
        allowed: true,
        count: 0,
        max: unlimited ? Infinity : max,
        live: { used: 0, max: liveMax },
      };
    }
    return {
      allowed: unlimited || count <= max,
      count,
      max: unlimited ? Infinity : max,
      live: { used: await liveUsed(), max: liveMax },
    };
  }

  /** Read both counters without spending: the after-the-call view that
   *  meta.quota reports, so a live fetch made by the tool is included. */
  spendQuota.describe = async () => {
    let count = 0;
    try {
      const { rows } = await db.query(
        `select count from rate_limit where bucket = $1 and window_start = $2::date`,
        [`mcpday#${budget.accountId}`, day()],
      );
      count = Number(rows[0]?.count ?? 0);
    } catch {
      // Described, never enforced: zero is the honest fallback.
    }
    return { count, live: { used: await liveUsed(), max: liveMax } };
  };
  return spendQuota;
}

/** The meta.quota block (contracts meta.ts): Infinity becomes null. */
export function quotaMeta({ count, max, live }) {
  const block = (used, cap) =>
    Number.isFinite(cap)
      ? { used, max: cap, remaining: Math.max(0, cap - used) }
      : { used, max: null, remaining: null };
  return {
    calls: block(count ?? 0, max),
    live: block(live?.used ?? 0, live?.max ?? Infinity),
    resets_at: quotaResetsAt(),
  };
}
