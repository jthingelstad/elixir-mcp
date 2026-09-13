/** One clock vocabulary for every surface.
 *
 *  These lived as near-identical copies in the console's Status.jsx and
 *  Dashboard.jsx while Admin.jsx rendered raw `toLocaleTimeString()`,
 *  which is how the public status page and the admin collectors table
 *  came to disagree about the same collector (2026-09-06); then the
 *  console's copy and Elixir Clan's drifted the same way. Relative
 *  deltas are timezone free; an absolute local wall-clock time is not,
 *  and it silently wraps after a day. Import from here rather than
 *  writing another one.
 */

/** Seconds since `ts`, or null when there is no timestamp.
 *
 *  Clamped at zero: the browser clock and the server clock disagree by
 *  a second or two, and a collector that just heartbeated would
 *  otherwise render "-1s ago". */
export function secsSince(
  ts: string | number | Date | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!ts) return null;
  return Math.max(0, (now - new Date(ts).getTime()) / 1000);
}

/** Coarse relative time from an age in seconds: "just now", "12s ago",
 *  "4m ago", "60m ago", "3h ago", "2d ago". The unit turns over late
 *  (90 s, 90 min, 2 d) so a reading stays in the finer unit while it is
 *  still worth reading that way - "75m ago" says more than "1h ago"
 *  about a poll. This is the vocabulary Elixir's own freshness pill
 *  used and Clan copied; the console's lib/time turned over at 60/3600
 *  and the two disagreed about the same instant. */
export function agoSeconds(s: number | null | undefined): string {
  if (s == null || Number.isNaN(s)) return "never";
  if (s < 1) return "just now";
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Coarse relative time from a timestamp. */
export function ago(
  ts: string | number | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!ts) return "never";
  return agoSeconds(secsSince(ts, now));
}

/** Exact relative time, two units: "12s ago", "3m 12s ago", "2h 14m ago",
 *  "3d 5h ago". For a table that is read to compare rows against each
 *  other - the fleet page, where "3m ago" five times over hid that the
 *  collectors were fetching in lockstep (2026-09-11). Reads as of the
 *  `now` it was rendered with, like `ago`. */
export function agoExact(
  ts: string | number | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!ts) return "never";
  const s = Math.round(secsSince(ts, now) ?? 0);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  if (s < 86400)
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ago`;
}

/** The freshness pill's class for an age: live under 15 minutes, stale
 *  under a day, then plain. */
export function freshCls(s: number | null | undefined): string {
  if (s == null) return "freshness freshness--never";
  if (s < 900) return "freshness freshness--live";
  if (s < 86400) return "freshness freshness--stale";
  return "freshness";
}

/** Freshness of a HEARTBEAT, held to a much tighter standard. A
 *  collector touches the door every few seconds, and its own watchdog
 *  exits after 5 minutes without a round-trip, so a heartbeat older
 *  than that means the process is gone rather than idle. */
export function beatCls(s: number | null | undefined): string {
  if (s == null) return "freshness freshness--never";
  if (s < 300) return "freshness freshness--live";
  if (s < 3600) return "freshness freshness--stale";
  return "freshness";
}
