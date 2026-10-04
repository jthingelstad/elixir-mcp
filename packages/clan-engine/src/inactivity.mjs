const DAY = 86400_000;

/** Counter increases prove play inside an observation bracket, never a
 * precise battle time or mode. A missing capture is not proof of no play.
 * No freshness allowance is invented for the unmeasured tail. */
export function inactivityEvidence(member, at) {
  const now = at instanceof Date ? at.getTime() : at;
  const stamp = (s) => (s == null ? NaN : Date.parse(s));
  const captured = stamp(member.last_battle_time);
  const joined = stamp(member.joined_observed_at);
  const rows = member.activity_evidence?.observations ?? [];
  const day = (row) =>
    row.snapshot_date ?? row.profile_observed_at?.slice(0, 10);
  const gapDays = (member.activity_evidence?.profile_gaps ?? []).map(
    (gap) => gap.snapshot_date,
  );
  const intervals = [];
  let malformed = false;
  let previous = null;
  for (const row of rows) {
    const t = stamp(row.profile_observed_at);
    const count = row.battle_count;
    const valid =
      Number.isFinite(t) && t <= now && Number.isInteger(count) && count >= 0;
    if (!valid) malformed = true;
    if (previous) {
      if (t <= previous.t || count < previous.count) malformed = true;
      if (
        valid &&
        t > previous.t &&
        !gapDays.some((d) => d > previous.day && d <= day(row)) &&
        count > previous.count
      )
        intervals.push({
          observed_from: new Date(previous.t).toISOString(),
          observed_to: new Date(t).toISOString(),
          counter_increase: count - previous.count,
          no_battles_captured:
            !Number.isFinite(captured) || captured <= previous.t,
        });
    }
    previous = valid ? { t, count, day: day(row) } : null;
  }
  const latest = previous?.t;
  const increase = intervals.at(-1) ?? null;
  const possible = Math.max(
    Number.isFinite(captured) ? captured : -Infinity,
    Number.isFinite(joined) ? joined : -Infinity,
    increase ? stamp(increase.observed_to) : -Infinity,
  );
  const first = stamp(rows[0]?.profile_observed_at);
  const quietSince = Math.max(first, possible);
  const tail = Number.isFinite(latest) ? Math.max(0, now - latest) : null;
  const gapped = gapDays.some((d) => d >= day(rows[0] ?? {}));
  let reason = null;
  if (member.activity_evidence?.current_member === false)
    reason = "The player is no longer a current member.";
  else if (member.activity_evidence?.unavailable)
    reason = "Current profile counter evidence could not be read.";
  else if (malformed || (Number.isFinite(captured) && captured > now))
    reason = "Profile counters or observation times are not comparable.";
  else if (rows.length < 2)
    reason = "There is no comparable profile counter baseline.";
  else if (gapped)
    reason = "Profile observations are missing inside the measured window.";
  else if (tail > 0)
    reason = "Time after the latest profile counter observation is unmeasured.";
  // This describes only the measured narrow counter window. It preserves
  // factual triage and the optional away question; it is never removal proof.
  const counterWindowMeasured = reason === null;
  // No current source establishes absence of own-player battle activity
  // across every mode. Even an exact-time flat counter must hold removal.
  // Never accept a caller-supplied coverage flag in place of a source contract.
  reason ??= "Absence of battle activity across every mode is not established.";
  return {
    status: "held",
    reason,
    counter_window_measured: counterWindowMeasured,
    measured_through: Number.isFinite(latest)
      ? new Date(latest).toISOString()
      : null,
    unmeasured_tail_hours:
      tail == null ? null : Number((tail / 3600_000).toFixed(2)),
    // Keep the private evaluation and response bounded; the full retained
    // series is used above, but only recent positive brackets are listed.
    positive_intervals: intervals.filter(
      (r) => stamp(r.observed_to) >= now - 7 * DAY,
    ),
    latest_activity_interval: increase,
    profile_gap_days: gapDays,
    captured_battle_at: Number.isFinite(captured)
      ? new Date(captured).toISOString()
      : null,
    captured_battle_age_days: Number.isFinite(captured)
      ? Number(((now - captured) / DAY).toFixed(2))
      : null,
    days_since_possible_activity: Number.isFinite(possible)
      ? Math.max(0, (now - possible) / DAY)
      : null,
    counter_quiet_days:
      !malformed &&
      !gapped &&
      rows.length >= 2 &&
      Number.isFinite(quietSince) &&
      Number.isFinite(latest)
        ? Math.max(0, (latest - quietSince) / DAY)
        : null,
    note: "Counter evidence describes counted play between profile observations. Flat counters, missing captures and unmeasured time do not establish absence of battle activity across every mode; no exact battle time or mode is inferred.",
  };
}
