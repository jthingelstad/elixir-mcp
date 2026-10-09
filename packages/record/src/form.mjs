/**
 * Form: "am I improving?" read back as numbers (2026-10-08).
 *
 * Elixir says what happened; this sets one stretch of a player's own
 * record beside another, in one mode, and stops there. Two readings:
 *
 *  - the week: one game week against the four before it (Ladder's
 *    "This week vs your last 4" strip, and the line in Tuesday's Arena
 *    mail);
 *  - the deck change: the season before and since the first battle on
 *    the deck the player has played most this season (Ladder).
 *
 * Every number is battles_performance's own (`window`/`compare_window`,
 * or `before`/`after`), one call, one mode: modes are different games,
 * so nothing here pools them, and nothing here computes a rate. The
 * shaping only decides what may be shown: a side under
 * FORM_MIN_BATTLES is too few to set beside another, and then nothing
 * is shown. No verdict, no score, no "better" (docs/DECISIONS.md).
 *
 * Pure and browser-safe: the Ladder page and the jobs Lambda's mail
 * builder both import it, so the windows, the minimum and the shape
 * are one function, not two.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** The fewest battles each side needs before it is set beside the
 *  other: decided battles for the win rate, head-to-head battles for
 *  the three-crown rate, the mode's battles for net trophies. Below it
 *  on either side, that number is not shown; below it for the win rate,
 *  nothing is. Ten is a week of a few short sessions. */
export const FORM_MIN_BATTLES = 10;

/** How many game weeks the week is set beside. */
export const FORM_PREVIOUS_WEEKS = 4;

/** The modes whose battles move trophies (Trophy Road) or the Path of
 *  Legends rating and league trophies: net_trophies means something
 *  only there. */
const TROPHY_MODES = new Set(["ladder", "ranked"]);

const iso = (ms) => new Date(ms).toISOString();

/** The start of the game week holding `atMs`: the most recent Monday
 *  10:00Z at or before it, the policy grid every clan shares (docs
 *  clocks.md) and the week the Arena mail reports. UTC throughout; a
 *  time zone only names it on a page. */
export function gameWeekStartMs(atMs = Date.now()) {
  const d = new Date(atMs);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  let monday = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - dow,
    10,
  );
  if (monday > atMs) monday -= WEEK_MS;
  return monday;
}

/** The two windows: the game week starting at `weekStartMs` (to its
 *  end, or open to now while it runs) and the four whole game weeks
 *  before it. */
export function formWindows(weekStartMs, { running = false } = {}) {
  return {
    week: {
      from: iso(weekStartMs),
      to: running ? null : iso(weekStartMs + WEEK_MS),
    },
    previous: {
      from: iso(weekStartMs - FORM_PREVIOUS_WEEKS * WEEK_MS),
      to: iso(weekStartMs),
    },
  };
}

/** battles_performance's arguments for the week reading: the week as
 *  the window, the four before as compare_window, in one mode. */
export function formArgs(windows, mode, base = {}) {
  return {
    ...base,
    from: windows.week.from,
    ...(windows.week.to ? { to: windows.week.to } : {}),
    compare_from: windows.previous.from,
    compare_to: windows.previous.to,
    mode,
  };
}

const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rate = (v) => (v == null || !Number.isFinite(Number(v)) ? null : v);

/** One side's numbers, each beside the count it is over. */
function side(w) {
  if (!w) return null;
  return {
    battles: count(w.battles),
    wins: count(w.wins),
    losses: count(w.losses),
    draws: count(w.draws),
    decided_battles: count(w.decided_battles),
    win_rate: rate(w.win_rate),
    head_to_head_battles: count(w.head_to_head_battles),
    three_crown_rate: rate(w.three_crown_rate),
    net_trophies: w.net_trophies ?? null,
  };
}

/** Two sides of one mode, or null when either is too few to set beside
 *  the other. A number whose own count is under the minimum on either
 *  side is dropped from both (null), so a pair is always like for like. */
function pair(a, b, mode) {
  const x = side(a);
  const y = side(b);
  const enough = (k) =>
    x && y && x[k] >= FORM_MIN_BATTLES && y[k] >= FORM_MIN_BATTLES;
  if (!enough("decided_battles") || x.win_rate == null || y.win_rate == null)
    return null;
  const crowns =
    enough("head_to_head_battles") &&
    x.three_crown_rate != null &&
    y.three_crown_rate != null;
  const trophies =
    TROPHY_MODES.has(mode) &&
    enough("battles") &&
    x.net_trophies != null &&
    y.net_trophies != null;
  const keep = (s) => ({
    ...s,
    three_crown_rate: crowns ? s.three_crown_rate : null,
    net_trophies: trophies ? s.net_trophies : null,
  });
  return { mode, a: keep(x), b: keep(y) };
}

/** The week reading from battles_performance's answer to formArgs:
 *  `{mode, week, previous}`, or null below the minimum. */
export function weekForm(perf, mode) {
  const p = pair(perf?.window, perf?.compare_window, mode);
  return p ? { mode, week: p.a, previous: p.b } : null;
}

/**
 * The deck change in one mode's season, from battles_decks' answer for
 * that season and mode sorted by battles (its first row is the deck
 * played most). It changed when that deck's first battle in the window
 * came after the window opened and other decks were played before it:
 * the split is that first battle. Null otherwise. The deck is named by
 * its archetype label, as battles_decks names it; a label is vocabulary,
 * never a verdict.
 */
export function deckChange(decks) {
  const top = decks?.decks?.[0];
  const opened = Date.parse(decks?.applied?.window?.from ?? "");
  const first = Date.parse(top?.first_used ?? "");
  if (!top || !Number.isFinite(first) || !Number.isFinite(opened)) return null;
  if (first <= opened) return null;
  if (count(decks.total_battles_in_window) <= count(top.battles)) return null;
  return {
    deck_hash: top.deck_hash,
    label: top.archetype_label ?? null,
    battles: count(top.battles),
    wins: count(top.wins),
    losses: count(top.losses),
    since: top.first_used,
  };
}

/** The deck reading from battles_performance's before_after answer
 *  (before_after = deckChange's `since`): `{mode, before, since}`, or
 *  null below the minimum. */
export function deckForm(perf, mode) {
  const p = pair(perf?.before, perf?.after, mode);
  return p ? { mode, before: p.a, since: p.b } : null;
}
