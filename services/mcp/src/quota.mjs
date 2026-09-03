/**
 * Daily tool-call quota — librarian's split kept: known (approved)
 * accounts FAIL OPEN (a broken counter must never take the service down
 * for legitimate users); there is no anonymous spend on this surface
 * (the OAuth gate precedes it), so no fail-closed pool is needed here.
 */

export const MCP_DAILY_QUOTA_DEFAULT = 500;

export function makeQuota({ db, account, max = MCP_DAILY_QUOTA_DEFAULT }) {
  return async function spendQuota() {
    if (account.isOwner) return { allowed: true, count: 0, max: Infinity };
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
