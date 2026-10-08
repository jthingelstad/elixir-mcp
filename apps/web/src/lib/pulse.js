/**
 * The beta pulse's cells (Admin ▸ Beta pulse; the counts come from
 * GET /api/admin/pulse, services/web-api/src/beta-pulse.mjs). Every cell
 * is a count and its share of the week's signups; nothing links to an
 * account.
 */

/** The funnel's columns after WEEK and SIGNED UP: [key, label, title]. */
export const PULSE_STEPS = [
  ["added_player", "PLAYER", "Added a player (any claim)"],
  ["primary_set", "PRIMARY", "Has a primary player"],
  ["profile", "PROFILE", "The primary has an admitted profile"],
  ["battles", "BATTLES", "The primary's battle log has been admitted"],
  ["clan_followed", "CLAN", "Follows a clan, or followed one"],
  ["clan_auto", "AUTO", "Of those, a clan Elixir followed for them"],
  ["verified", "VERIFIED", "Verified a player"],
];

/** "3 · 75%", or "0" when nobody signed up that week. */
export function share(count, of) {
  if (!of) return String(count);
  return `${count} · ${Math.round((count / of) * 100)}%`;
}

/** A came-back cell: its share, and how many are still inside the
 *  window (their answer can still change). */
export function backCell(count, open, of) {
  const text = share(count, of);
  if (!open) return text;
  return {
    text: `${text} (${open} open)`,
    title: `${open} of ${of} still inside the window: the share is so far, not final.`,
  };
}

/** One row per signup week, newest first, and the window's total last. */
export function pulseRows(pulse) {
  const row = (label, w) => [
    label,
    String(w.signed_up),
    ...PULSE_STEPS.map(([key]) => share(w[key], w.signed_up)),
    backCell(w.came_back_week1, w.week1_open, w.signed_up),
    backCell(w.came_back_week2, w.week2_open, w.signed_up),
  ];
  const weeks = [...(pulse?.weeks ?? [])].reverse();
  if (weeks.length === 0) return [];
  return [
    ...weeks.map((w) => row(w.week, w)),
    row(`${weeks.length} weeks`, pulse.totals),
  ];
}
