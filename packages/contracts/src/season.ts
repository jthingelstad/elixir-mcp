/**
 * Pre-reset snapshot window — DESIGN §4.5/§5.3.
 *
 * Weekly donation counters reset Mondays ~00:10 UTC and are IRRECOVERABLE
 * after the reset. In the final hour before it, the scheduler forces
 * profile polls and the snapshot projector writes an extra 'season_roll'
 * row. One window function shared by both so they can never disagree.
 * (Monthly trophy-season data survives via leagueStatistics.previousSeason
 * for a day, so the weekly window is the one that matters.)
 */

const RESET_UTC_MINUTES = 10; // Monday 00:10 UTC
const WINDOW_MINUTES = 60;

/** Milliseconds of the next Monday-00:10Z reset at or after `from`. */
export function nextDonationResetMs(from: Date): number {
  const d = new Date(from);
  const day = d.getUTCDay(); // 0 Sun .. 1 Mon
  const candidate = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    RESET_UTC_MINUTES,
  );
  let daysAhead = (1 - day + 7) % 7;
  if (daysAhead === 0 && from.getTime() >= candidate) daysAhead = 7;
  return candidate + daysAhead * 86_400_000;
}

export function inPreResetWindow(now: Date): boolean {
  const reset = nextDonationResetMs(now);
  return reset - now.getTime() <= WINDOW_MINUTES * 60_000;
}

export function preResetWindowStart(now: Date): Date {
  return new Date(nextDonationResetMs(now) - WINDOW_MINUTES * 60_000);
}
