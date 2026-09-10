/**
 * ONE reading of the daily quota, for both pages that show it.
 *
 * Usage and Settings each used to derive the ceiling on their own —
 * one from `/api/me/usage`, the other from `/api/me`'s entitlements
 * with a fallback — which is two sources for one number, and a fallback
 * that can disagree. The design's rule is that shared numbers are
 * derived once; this is where.
 *
 * `usage` is the body of /api/me/usage. A null limit means unlimited on
 * the wire (owner and admin), and reads as "∞" rather than as full.
 */
export function quotaReading(usage) {
  const line = (used, limit) => {
    const u = Number(used ?? 0);
    const unlimited = limit == null;
    const pct = unlimited ? 0 : Math.min(100, Math.round((u / limit) * 100));
    return {
      used: u,
      limit: unlimited ? null : Number(limit),
      pct,
      full: !unlimited && u >= limit,
      label: `${u.toLocaleString()} of ${unlimited ? "∞" : Number(limit).toLocaleString()}`,
    };
  };
  return {
    calls: line(usage?.today_calls, usage?.quota_max),
    fetches: line(usage?.live_today, usage?.live_max),
    resets: resetsLine(),
  };
}

/** "resets 00:00Z · 5h 16m" — the day boundary the limiter uses is UTC
 *  midnight, whatever the account's display timezone. */
function resetsLine(now = new Date()) {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
    ),
  );
  const mins = Math.max(0, Math.round((next - now) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `resets 00:00Z · ${h}h ${String(m).padStart(2, "0")}m`;
}
