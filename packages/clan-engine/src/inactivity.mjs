const DAY = 86400_000;

/**
 * A member's inactivity clock: how long since the latest sign of play in
 * Elixir's record. Idle means no battle (Jamie, 2026-10-12): "You have the
 * entire battle log inside of Elixir MCP", and a gap in a battle log
 * happens only to a player who plays a lot, never to an idle one. So the
 * clock runs from the last recorded battle, or the join when there is
 * none since. A rise in the profile's battle count between two reads is
 * play too: it only ever moves the clock forward, never back.
 *
 * Removal and the away question wait only when there is no clock to read:
 * the player has left, or the evidence read failed just now (the next run
 * reads it again). docs/notes/2026-10-12-clan-removal-runs-from-the-battle-log.md.
 */
export function inactivityEvidence(member, at) {
  const now = at instanceof Date ? at.getTime() : at;
  const stamp = (s) => (s == null ? NaN : Date.parse(s));
  const captured = stamp(member.last_battle_time);
  const joined = stamp(member.joined_observed_at);
  const rows = member.activity_evidence?.observations ?? [];

  // Each rise in the battle count between two comparable reads.
  const intervals = [];
  let previous = null;
  for (const row of rows) {
    const t = stamp(row.profile_observed_at);
    const count = row.battle_count;
    if (
      !Number.isFinite(t) ||
      t > now ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      previous = null;
      continue;
    }
    if (previous && t > previous.t && count > previous.count)
      intervals.push({
        observed_from: new Date(previous.t).toISOString(),
        observed_to: new Date(t).toISOString(),
        counter_increase: count - previous.count,
        no_battles_captured:
          !Number.isFinite(captured) || captured <= previous.t,
      });
    previous = { t, count };
  }
  const increase = intervals.at(-1) ?? null;
  const possible = Math.max(
    Number.isFinite(captured) && captured <= now ? captured : -Infinity,
    Number.isFinite(joined) && joined <= now ? joined : -Infinity,
    increase ? stamp(increase.observed_to) : -Infinity,
  );

  let reason = null;
  if (member.activity_evidence?.current_member === false)
    reason = "The player is no longer a current member.";
  else if (member.activity_evidence?.unavailable)
    reason = "Elixir could not read the member's activity just now.";
  else if (!Number.isFinite(possible))
    reason = "There is no recorded battle or join to start the clock from.";

  return {
    status: reason ? "held" : "ready",
    reason,
    // Keep the private evaluation and response bounded: only recent rises.
    positive_intervals: intervals.filter(
      (r) => stamp(r.observed_to) >= now - 7 * DAY,
    ),
    latest_activity_interval: increase,
    captured_battle_at: Number.isFinite(captured)
      ? new Date(captured).toISOString()
      : null,
    captured_battle_age_days: Number.isFinite(captured)
      ? Number(((now - captured) / DAY).toFixed(2))
      : null,
    days_since_possible_activity: Number.isFinite(possible)
      ? Math.max(0, (now - possible) / DAY)
      : null,
  };
}

/** The day a removal Action is raised: the policy's removal day (an
 *  absolute count of days without a battle, never before at risk) plus
 *  any grace the member earned. */
export function removalDay(policy, graceDays = 0) {
  return Math.max(policy.confirm_days, policy.at_risk_days) + graceDays;
}
