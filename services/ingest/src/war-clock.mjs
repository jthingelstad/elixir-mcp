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

const TRAINING_DAYS = 3;
const WAR_DAYS = 4;
const PERIODS_PER_SECTION = TRAINING_DAYS + WAR_DAYS;
const NOMINAL_RESET_HOUR_UTC = 10;
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

/**
 * The season calendar — stateless season/section derivation (the fix
 * for the 2026-09-04 phantom-season incident). CR seasons run first
 * Monday of month -> first Monday of next month, resetting ~09:30Z;
 * sections are the Mondays between. Verified against riverracelog
 * createdDate stamps: S134 = 2026-07-06 -> 2026-08-03 (sections
 * finishing Jul 13/20/27, Aug 3), S135 = 2026-08-03 -> 2026-09-07.
 * Stateful inference (rolling +1 on section walk-back) ran away when
 * archive payloads replayed against future logged state, scattering
 * nine real weeks across nine phantom seasons.
 */
// NOTE (2026-09-07, open question for Jamie): this 09:30Z season hour
// was derived from OBSERVED riverracelog createdDate stamps, while
// periods now follow the 10:00Z POLICY hour. Two nominal reset hours
// therefore coexist in this file. If the real policy is 10:00 for both,
// a season boundary observed between 09:30 and 10:00 on a first Monday
// is attributed to the new season half an hour early - a 30-minute
// window once a month. Left as observed rather than changed on a guess:
// moving it reshuffles season attribution for every historical week,
// which is a far larger blast radius than the period grid.
const SEASON_ANCHOR = { id: 135, startMs: Date.UTC(2026, 7, 3, 9, 30) };
const WEEK_MS = 7 * 24 * 3600_000;

function firstMondayResetMs(year, month) {
  const first = new Date(Date.UTC(year, month, 1, 9, 30));
  const day = first.getUTCDay(); // 0 Sun .. 6 Sat
  const offset = (8 - day) % 7;
  return Date.UTC(year, month, 1 + offset, 9, 30);
}

/** Season id + section index for an instant. */
export function seasonFromDate(atMs) {
  // Find the season start (first-Monday reset) at or before atMs, and
  // count seasons from the anchor.
  let year = new Date(atMs).getUTCFullYear();
  let month = new Date(atMs).getUTCMonth();
  let startMs = firstMondayResetMs(year, month);
  if (startMs > atMs) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    startMs = firstMondayResetMs(year, month);
  }
  // Count month-boundaries between the anchor start and this start.
  let seasonId = SEASON_ANCHOR.id;
  let cursor = SEASON_ANCHOR.startMs;
  while (cursor < startMs) {
    const d = new Date(cursor);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth() + 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    cursor = firstMondayResetMs(y, m);
    seasonId += 1;
  }
  while (cursor > startMs) {
    const d = new Date(cursor);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth() - 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    cursor = firstMondayResetMs(y, m);
    seasonId -= 1;
  }
  return {
    seasonId,
    sectionIndex: Math.floor((atMs - startMs) / WEEK_MS),
    seasonStartMs: startMs,
  };
}

export function inferSeasonId(liveSeasonId, logged, atMs = null) {
  if (typeof liveSeasonId === "number") return liveSeasonId;
  // Stateless: the calendar decides. The old logged-state roll inference
  // ran away under out-of-order processing (phantom-season incident).
  if (atMs !== null) return seasonFromDate(atMs).seasonId;
  if (!logged) return null;
  return logged.seasonId;
}

/** The most recent 10:00 UTC at or before an instant: the strict policy
 *  grid, with no drift tolerance. "When we are looking" is not an
 *  observation of a period opening, so it gets no benefit of the doubt. */
export function nominalPeriodStartMs(nowMs) {
  return nominalPeriodBoundsMs(nowMs, 0).startMs;
}

/**
 * The nominal bounds of the period an anchor belongs to, on the POLICY
 * grid: [the 10:00Z boundary this period opened at, that boundary + 1
 * day).
 *
 * Supercell's policy reset is 10:00 UTC, but clans are matched into
 * races of five as matchmaking fills, so a clan's real period start
 * drifts off the hour - and our own anchor is when the RECORDER first
 * saw the period open, which adds polling latency on top. Snapping to
 * the policy grid is what makes a war day mean the same 24 hours for
 * every clan, which is the whole point of a multi-clan service.
 *
 * The drift runs EARLY as often as late, so an anchor observed minutes
 * BEFORE the hour still belongs to the period that hour opens: allow an
 * hour of early drift before deciding the anchor belongs to the
 * previous boundary. Taking "the next 10:00Z after the anchor" instead
 * collapsed the period to minutes long whenever the reset ran early.
 *
 * ONE definition, used by every surface that reports or gates on the
 * period. It was duplicated in two tool paths and drifted between them.
 */
export function nominalPeriodBoundsMs(anchorMs, driftToleranceMs = 3600_000) {
  const d = new Date(anchorMs + driftToleranceMs);
  let startMs = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    NOMINAL_RESET_HOUR_UTC,
  );
  if (startMs > anchorMs + driftToleranceMs) startMs -= DAY_MS;
  return { startMs, endMs: startMs + DAY_MS };
}

/**
 * The clock at an observation: current period + its start instant.
 *
 * POLICY GRID (Jamie, 2026-09-07). Supercell's reset is 10:00 UTC by
 * policy, but clans are matched into races of five as matchmaking
 * fills, so each clan's real period start drifts off the hour by a
 * different amount. A single-clan tool can measure its own clan's drift
 * and follow it - elixir-bot does, for POAP KINGS. A multi-clan service
 * cannot honour every clan's start time and still have "war day 3" mean
 * one comparable window, so Elixir MCP follows the POLICY hour for
 * every clan.
 *
 * Two further reasons this is not just a simplification. Our anchor is
 * when the RECORDER first saw the period open, so it carries polling
 * latency and mostly measures our own cadence on a clan we poll rarely
 * (the war_drift census: 35 anchors for POAP KINGS, one apiece for
 * clans added recently, several sharing an offset because one sweep
 * first saw them all). And the policy grid is a pure function of time,
 * so a replay assigns the same war day the live run did - the stateless
 * lesson already learned in the phantom-season incident, one level down.
 *
 * COST, stated rather than hidden: a clan whose race really opens
 * before the hour has battles in that gap attributed to the previous
 * policy day. The gap is the drift (tens of minutes, sometimes up to
 * two hours) and it sits in a busy part of the day. periodStartMs is
 * the policy boundary; observedStartMs keeps the raw anchor so a
 * single-clan consumer can still correct for its own drift.
 *
 * anchorMs = when this periodIndex was first observed open (projector
 * records it). It selects WHICH policy day the period belongs to; a
 * missing or stale anchor (>24h) falls back to the grid at nowMs.
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
  // The anchor picks the policy DAY (it may sit slightly before the
  // hour, hence the drift tolerance); it no longer sets the boundary.
  const bounds = anchorFresh
    ? nominalPeriodBoundsMs(anchorMs)
    : nominalPeriodBoundsMs(nowMs, 0);
  return {
    seasonId: inferSeasonId(
      seasonId,
      logged ? { ...logged, liveSectionIndex: sectionIndex } : null,
      nowMs,
    ),
    sectionIndex,
    periodIndex,
    periodStartMs: bounds.startMs,
    periodEndMs: bounds.endMs,
    // The raw observation, kept and reported rather than used as the
    // boundary. null when this period was never seen open.
    observedStartMs: anchorMs,
    // Whether a usable anchor picked the policy day (vs falling back to
    // the grid at nowMs). It no longer means "the anchor is the start".
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
