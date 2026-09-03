/**
 * The war clock — pure calendar math over river-race state (DESIGN §4.5;
 * pattern: elixir-bot engine/clock.py, verified there against 259 archived
 * payloads and here against our own captured ones).
 *
 * Facts encoded:
 *  - periodIndex // 7 === sectionIndex (cross-checked at admission too);
 *  - periodIndex % 7: 0-2 training, 3-6 battle days (warDay 1..4);
 *  - Colosseum is always the season's final section; its practice days
 *    still report periodType 'training';
 *  - seasonId is often ABSENT from payloads — always inferable, never
 *    required (live value wins; else latest logged season, +1 when the
 *    live section walked backwards past the logged one);
 *  - period boundaries drift: the observed anchor (when a period was
 *    first seen open) beats the nominal ~10:00 UTC reset hour, and a
 *    stale anchor falls back rather than going negative;
 *  - battles get war keys from their OWN battle_time, never poll time.
 */

export const PERIODS_PER_SECTION = 7;
export const TRAINING_DAYS = 3;
export const WAR_DAYS = 4;
export const NOMINAL_RESET_HOUR_UTC = 10;
const DAY_MS = 24 * 3600_000;

export function periodInfo(periodIndex) {
  const sectionIndex = Math.floor(periodIndex / PERIODS_PER_SECTION);
  const dayInSection = periodIndex % PERIODS_PER_SECTION;
  const isWarDay = dayInSection >= TRAINING_DAYS;
  return {
    sectionIndex,
    dayInSection,
    kind: isWarDay ? "war" : "training",
    warDay: isWarDay ? dayInSection - TRAINING_DAYS + 1 : null, // 1..4
  };
}

/** Live season id wins; otherwise infer from the latest logged (season,
 *  section): a live section LOWER than the logged one means we rolled. */
export function inferSeasonId(liveSeasonId, logged) {
  if (typeof liveSeasonId === "number") return liveSeasonId;
  if (!logged) return null;
  const currentSection = logged.liveSectionIndex;
  if (
    typeof currentSection === "number" &&
    currentSection < logged.sectionIndex
  ) {
    return logged.seasonId + 1;
  }
  return logged.seasonId;
}

/** Nominal fallback period start for "now": the most recent 10:00 UTC. */
export function nominalPeriodStartMs(nowMs) {
  const d = new Date(nowMs);
  const todayReset = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    NOMINAL_RESET_HOUR_UTC,
  );
  return nowMs >= todayReset ? todayReset : todayReset - DAY_MS;
}

/**
 * The clock at an observation: current period + its start instant.
 * anchorMs = when this periodIndex was first observed open (projector
 * records it); a missing or stale anchor (>24h old) falls back to the
 * nominal reset grid rather than producing a negative-length period.
 */
export function warClock(
  { periodIndex, sectionIndex, periodType, seasonId },
  { nowMs, anchorMs = null, logged = null },
) {
  if (Math.floor(periodIndex / PERIODS_PER_SECTION) !== sectionIndex) {
    throw new Error(
      `periodIndex ${periodIndex} does not sit in sectionIndex ${sectionIndex}`,
    );
  }
  const info = periodInfo(periodIndex);
  const anchorFresh =
    anchorMs !== null && nowMs - anchorMs < DAY_MS && nowMs >= anchorMs;
  const periodStartMs = anchorFresh ? anchorMs : nominalPeriodStartMs(nowMs);
  return {
    seasonId: inferSeasonId(
      seasonId,
      logged ? { ...logged, liveSectionIndex: sectionIndex } : null,
    ),
    sectionIndex,
    periodIndex,
    periodStartMs,
    anchored: anchorFresh,
    // The payload's periodType wins for display (colosseum practice days
    // still say 'training'); the %7 grid decides war-day numbering.
    kind: periodType === "colosseum" ? "colosseum" : info.kind,
    warDay: info.warDay,
  };
}

/**
 * War keys for a battle from ITS OWN time: walk whole war-dates back from
 * the observed period start. Battles before the current section's start
 * get null keys (cross-season attribution is not guessed).
 */
export function resolveWarKeys(battleTimeMs, clock) {
  const daysBack =
    battleTimeMs >= clock.periodStartMs
      ? 0
      : Math.ceil((clock.periodStartMs - battleTimeMs) / DAY_MS);
  const battlePeriodIndex = clock.periodIndex - daysBack;
  if (battlePeriodIndex < 0)
    return { seasonId: null, sectionIndex: null, warDay: null };
  const info = periodInfo(battlePeriodIndex);
  if (info.sectionIndex !== clock.sectionIndex) {
    // Earlier section (or season): attribution needs the war log, not
    // arithmetic across reset drift. Honest null.
    return { seasonId: null, sectionIndex: null, warDay: null };
  }
  return {
    seasonId: clock.seasonId ?? null,
    sectionIndex: info.sectionIndex,
    warDay: info.warDay, // null on training days — training battles carry no war day
  };
}
