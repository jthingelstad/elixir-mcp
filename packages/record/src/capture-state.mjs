/** Evidence, not freshness: a poll or a zero row count cannot prove absence.
 * These pure rules are shared by the browser and the internal Clan gate. */
const instant = (value) => {
  if (value == null || value === "") return NaN;
  return new Date(value).getTime();
};

export function hasBattleEvidence(player) {
  return Boolean(
    player &&
    (player.battles_30d > 0 || Number.isFinite(instant(player.last_battle_at))),
  );
}

/** A whole window is covered only by contiguous, comparable COMPLETE
 * observation intervals. The seven-day average and poll times are ignored.
 * An incomplete/unknown overlap wins; an unread sweep cannot prove a zero.
 * Positive battle rows remain evidence regardless of the coverage estimate. */
export function battleCapture({
  from,
  to,
  intervals = [],
  recordedBattles = 0,
  readComplete = true,
}) {
  const start = instant(from);
  const end = instant(to);
  const observations = Array.isArray(intervals) ? intervals : [];
  const validBounds = observations.every(
    (i) => instant(i?.observed_from) < instant(i?.observed_to),
  );
  const spans = observations
    .map((i) => ({
      from: instant(i?.observed_from),
      to: instant(i?.observed_to),
      complete:
        i?.is_complete === true &&
        Number.isInteger(i.expected_battles) &&
        i.expected_battles >= 0 &&
        i.expected_battles === i.captured_battles,
    }))
    .filter((i) => i.from < i.to && i.from < end && i.to >= start)
    .sort((a, b) => a.from - b.from);
  let coveredTo = start;
  let started = false;
  for (const span of spans) {
    // Observation intervals are (from, to]; a first interval starting
    // exactly at the day's start does not establish that boundary.
    if (
      !span.complete ||
      (started ? span.from > coveredTo : span.from >= start)
    )
      break;
    started = true;
    coveredTo = Math.max(coveredTo, span.to);
  }
  const complete =
    Number.isFinite(start) &&
    start < end &&
    validBounds &&
    readComplete &&
    started &&
    coveredTo >= end &&
    spans.every((i) => i.complete);
  const coverage = complete ? "complete" : spans.length ? "partial" : "unknown";
  return {
    coverage,
    has_battles: recordedBattles > 0,
    quiet: complete && recordedBattles === 0,
  };
}

/** An explicit absent clan in an observed profile is evidence of absence
 * at that stamp, never a live claim. Missing/invalid evidence is unknown. */
export function membershipCapture(observation) {
  const at = instant(observation?.observed_at);
  if (
    !Number.isFinite(at) ||
    at > Date.now() ||
    !["member", "none"].includes(observation?.state)
  )
    return { state: "unknown", observed_at: null };
  return {
    state: observation.state,
    observed_at: new Date(at).toISOString(),
  };
}
