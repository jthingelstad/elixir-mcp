/**
 * A collector's silence, read the same way by the tool and the sweep
 * (2026-09-19). Collectors long-poll the door, so an active one's
 * heartbeat is never more than about a minute old; one that has not
 * checked in for an hour is not fetching, whatever its lifecycle status
 * says. `draining` and `revoked` are intentional stops and never silent.
 */
const SILENT_AFTER_MS = 60 * 60_000;

/** The reading elixir_collectors and the sweep share: silent when the
 *  collector is meant to be running and has not checked in within the
 *  threshold (never, for one enrolled longer ago than that). */
export function silentSince(
  { status, last_heartbeat_at, enrolled_at },
  nowMs = Date.now(),
  thresholdMs = SILENT_AFTER_MS,
) {
  if (status !== "active" && status !== "probation") return null;
  const since = last_heartbeat_at ?? enrolled_at;
  if (!since) return null;
  const sinceMs = new Date(since).getTime();
  return nowMs - sinceMs > thresholdMs ? new Date(sinceMs) : null;
}
