/**
 * The timeline reaches back one week from now (lookback.mjs), and these
 * tests read fixtures recorded on fixed days in 2026-09 and 2026-10. A
 * read that names a window is made with the clock set to the week that
 * window opens: `from` plus seven days (never later than the real now),
 * so the read is the one a caller made that week. A read with only `to`
 * is made at `to`. Date alone is mocked; Postgres keeps its own clock.
 */
import { mock } from "node:test";
import { TIMELINE_LOOKBACK_MS } from "../src/activity/lookback.mjs";

/** The instant a read of `args` is made at, or null for the real now. */
export function windowClock(args = {}) {
  const at = (v) => (v === undefined ? NaN : Date.parse(String(v)));
  const from = at(args.from);
  if (Number.isFinite(from))
    return Math.min(from + TIMELINE_LOOKBACK_MS, Date.now());
  const to = at(args.to);
  if (Number.isFinite(to)) return Math.min(to, Date.now());
  return null;
}

/** Run `fn` with Date set to `windowClock(args)`, when it names one. */
export async function atWindowClock(args, fn) {
  const now = windowClock(args);
  if (now === null) return fn();
  mock.timers.enable({ apis: ["Date"], now });
  try {
    return await fn();
  } finally {
    mock.timers.reset();
  }
}
