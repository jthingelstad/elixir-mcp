/**
 * The rhythm arithmetic shared by the placement scorer ({rhythm_score}
 * on the migrate Lambda) and the planner (adaptive polling step two,
 * NOTES 2026-09-12 "The adaptive-polling direction").
 *
 * A rhythm is the nightly `player_activity.rhythm`: 168 decayed weights
 * indexed (isodow - 1) * 24 + UTC hour, Monday 00:00Z first
 * (services/jobs/src/activity.mjs). Normalised to unit mass it is the
 * share of a player's week that falls in each hour; multiplied by a
 * weekly battle count it is a rate, and the integral of that rate over
 * an interval is how many battles the rhythm expects there. Everything
 * here is pure and UTC.
 */

export const BUCKETS = 168;
const HOUR = 3600_000;
const WEEK = 7 * 24 * HOUR;

/** Bucket index of an instant: (isodow - 1) * 24 + UTC hour. */
export function bucketOf(ms) {
  const d = new Date(ms);
  const isodow = ((d.getUTCDay() + 6) % 7) + 1;
  return (isodow - 1) * 24 + d.getUTCHours();
}

/** Unit-mass copy of a rhythm, or null when it carries no weight. */
export function normalize(rhythm) {
  if (!Array.isArray(rhythm) || rhythm.length !== BUCKETS) return null;
  let total = 0;
  for (const w of rhythm) total += Number(w) || 0;
  if (!(total > 0)) return null;
  return rhythm.map((w) => (Number(w) || 0) / total);
}

/** Start of the UTC hour containing `ms`. */
function hourFloor(ms) {
  return Math.floor(ms / HOUR) * HOUR;
}

/**
 * Walk the hour buckets an interval (from, to] touches, calling
 * `visit(bucket, fraction)` with the share of that hour inside the
 * interval. An interval longer than a week is a whole number of weeks
 * plus the remainder, so the walk is never longer than 168 + 1 steps.
 */
function walk(fromMs, toMs, visit) {
  if (!(toMs > fromMs)) return 0;
  let weeks = 0;
  let span = toMs - fromMs;
  if (span >= WEEK) {
    weeks = Math.floor(span / WEEK);
    span -= weeks * WEEK;
  }
  const end = fromMs + span;
  for (let h = hourFloor(fromMs); h < end; h += HOUR) {
    const lo = Math.max(h, fromMs);
    const hi = Math.min(h + HOUR, end);
    if (hi > lo) visit(bucketOf(h), (hi - lo) / HOUR);
  }
  return weeks;
}

/** Share of the player's weekly mass inside (from, to]. Whole weeks
 *  count 1 each. `mass` is a normalised rhythm. */
export function massBetween(mass, fromMs, toMs) {
  let sum = 0;
  const weeks = walk(fromMs, toMs, (b, f) => {
    sum += mass[b] * f;
  });
  return sum + weeks;
}

/** Battles the rhythm expects in (from, to] at `weekly` battles a week. */
export function expectedBattles(mass, weekly, fromMs, toMs) {
  return weekly * massBetween(mass, fromMs, toMs);
}

/** The largest single-hour mass the interval (from, to] touches, even
 *  partially: whether the wait crossed one of the player's peak hours. */
export function peakMassBetween(mass, fromMs, toMs) {
  let peak = 0;
  const weeks = walk(fromMs, toMs, (b) => {
    if (mass[b] > peak) peak = mass[b];
  });
  if (weeks > 0) return Math.max(...mass);
  return peak;
}

/**
 * The first instant after `fromMs` at which the rhythm expects `target`
 * battles to have accumulated, bounded to [floorMs, ceilingMs] after
 * `fromMs`. A rhythm too quiet to reach the target inside the ceiling
 * answers the ceiling: dormant means the worst case, never longer.
 */
export function nextDueMs(
  mass,
  weekly,
  fromMs,
  target,
  { floorMs, ceilingMs },
) {
  const latest = fromMs + ceilingMs;
  if (!(weekly > 0)) return latest;
  let acc = 0;
  for (let h = hourFloor(fromMs); h < latest; h += HOUR) {
    const lo = Math.max(h, fromMs);
    const hi = Math.min(h + HOUR, latest);
    const rate = mass[bucketOf(h)] * weekly; // battles per hour, this hour
    const gain = rate * ((hi - lo) / HOUR);
    if (acc + gain >= target) {
      const need = target - acc;
      const at = rate > 0 ? lo + (need / rate) * HOUR : hi;
      return Math.max(fromMs + floorMs, Math.min(latest, at));
    }
    acc += gain;
  }
  return latest;
}

/**
 * The fleet's rhythm: the mean of the given players' unit-mass rhythms,
 * each player counting once, so a grinder does not become everyone's
 * evening. Null when no player carries weight.
 */
export function fleetMass(rhythms) {
  const sum = new Array(BUCKETS).fill(0);
  let n = 0;
  for (const r of rhythms) {
    const m = normalize(r);
    if (!m) continue;
    n += 1;
    for (let i = 0; i < BUCKETS; i++) sum[i] += m[i];
  }
  if (n === 0) return null;
  return sum.map((v) => v / n);
}
