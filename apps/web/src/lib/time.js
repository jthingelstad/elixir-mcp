/** One clock vocabulary for every surface.
 *
 *  These lived as near-identical copies in Status.jsx and Dashboard.jsx
 *  while Admin.jsx rendered raw `toLocaleTimeString()`, which is how the
 *  public status page and the admin collectors table came to disagree
 *  about the same collector (2026-09-06). Relative deltas are timezone
 *  free; an absolute local wall-clock time is not, and it silently wraps
 *  after a day. Import from here rather than writing another one.
 */

/** Seconds since `ts`, or null when there is no timestamp.
 *
 *  Clamped at zero: the browser clock and the server clock disagree by
 *  a second or two, and a collector that just heartbeated would
 *  otherwise render "-1s ago". */
export function secsSince(ts, now = Date.now()) {
  return ts ? Math.max(0, (now - Date.parse(ts)) / 1000) : null;
}

/** Coarse relative time: "12s ago", "4m ago", "3h ago", "2d ago". */
export function ago(ts, now = Date.now()) {
  if (!ts) return "never";
  const s = secsSince(ts, now);
  if (s < 1) return "just now";
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Freshness of recorded DATA: a collector can idle a while between
 *  admitted payloads without anything being wrong. */
export function freshCls(seconds) {
  if (seconds == null) return "freshness freshness--never";
  if (seconds < 900) return "freshness freshness--fresh";
  if (seconds < 86400) return "freshness freshness--stale";
  return "freshness";
}

/** Freshness of a HEARTBEAT, held to a much tighter standard. A
 *  collector touches the door every few seconds, and its own watchdog
 *  exits after 5 minutes without a round-trip, so a heartbeat older
 *  than that means the process is gone rather than idle. */
export function beatCls(seconds) {
  if (seconds == null) return "freshness freshness--never";
  if (seconds < 300) return "freshness freshness--fresh";
  if (seconds < 3600) return "freshness freshness--stale";
  return "freshness";
}
