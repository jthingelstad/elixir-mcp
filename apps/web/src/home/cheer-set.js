/**
 * The cheers. Six since 2026-11-12 (Jamie: "Yes, six cheers
 * (Recommended)"; the design canvas's set), twenty since 2026-11-17 (Jamie:
 * "Reactions should not need words next to them. And give more options."
 * and "Give 6 reactions to the user and even more on a tap for more
 * options."). Every one celebrates or plays: there is no thumbs-down, no
 * anger, nothing mocking, and players are often kids. The keys are the
 * server's (packages/tools/src/activity/cheers.mjs, 0243 and 0286); a test
 * pins the two lists together, and the first six keep the ids they have
 * always had.
 *
 * Each is drawn with one Lucide glyph ("Lucide is the glyph library"),
 * shown alone: the name is only the control's accessible name, its
 * tooltip and the words of text surfaces (the bell's description, the
 * docs). This list is the one map from a kind to its glyph and name, and
 * every place that shows a kind draws it through <CheerGlyph>
 * (CheerGlyph.jsx). Mail, push, Discord, RSS and MCP keep their words and
 * never name a kind.
 *
 * Order matters. The first `LEAD` are offered at once, in this fixed order
 * so the thumb learns them; the rest come with More, most used first.
 * The first of all is the default: one tap gives it.
 */
export const CHEERS = [
  // The six offered at once (the 2026-11-12 set; Royal's glyph moved from
  // the crown, which means a Ranked league and the game's crowns, to a gem).
  { key: "well_played", icon: "thumbs-up", label: "Well played" },
  { key: "on_fire", icon: "flame", label: "On fire" },
  { key: "royal", icon: "gem", label: "Royal" },
  { key: "wow", icon: "sparkles", label: "Wow" },
  { key: "ha", icon: "laugh", label: "Ha" },
  { key: "grind", icon: "biceps-flexed", label: "Grind" },
  // More (2026-11-17).
  { key: "love_it", icon: "heart", label: "Love it" },
  { key: "good_game", icon: "handshake", label: "Good game" },
  { key: "congrats", icon: "party-popper", label: "Congrats" },
  { key: "clutch", icon: "zap", label: "Clutch" },
  { key: "high_five", icon: "hand", label: "High five" },
  { key: "champion", icon: "medal", label: "Champion" },
  { key: "nailed_it", icon: "target", label: "Nailed it" },
  { key: "climbing", icon: "rocket", label: "Climbing" },
  { key: "big_brain", icon: "brain", label: "Big brain" },
  { key: "ice_cold", icon: "snowflake", label: "Ice cold" },
  { key: "close_one", icon: "hourglass", label: "Close one" },
  { key: "lucky", icon: "clover", label: "Lucky" },
  { key: "fun_to_watch", icon: "popcorn", label: "Fun to watch" },
  { key: "getting_better", icon: "sprout", label: "Getting better" },
];

/** How many are offered at once, before More. */
export const LEAD = 6;
export const LEAD_CHEERS = CHEERS.slice(0, LEAD);

/** The cheer one tap gives (2026-11-17, "A cheer is one tap"). */
export const DEFAULT_CHEER = CHEERS[0].key;

/** How many kinds an item's counts show before the rest fold into one
 *  number (yours is always shown as well). */
export const TOP_KINDS = 3;

const BY_KEY = new Map(CHEERS.map((c) => [c.key, c]));

/** Whether a stored kind is one this build knows. */
export const knownCheer = (key) => BY_KEY.has(key);

/** A kind as its words and glyph, the default's for an unknown key (a
 *  kind a newer server stored, drawn safely by an older page). */
export const cheerOf = (key) => BY_KEY.get(key) ?? CHEERS[0];

/** The known cheers an item has, in the set's order, with their counts. */
export const cheerCounts = (cheers) =>
  CHEERS.filter((c) => (cheers?.[c.key] ?? 0) > 0).map((c) => ({
    ...c,
    count: cheers[c.key],
  }));

/** Every cheer on an item, kinds this build does not know included. */
export const cheerTotal = (cheers) =>
  Object.values(cheers ?? {}).reduce((n, v) => n + (Number(v) || 0), 0);

/**
 * An item's counts as a busy item shows them: the `top` kinds by count
 * (ties in the set's order), yours always among them, and the rest folded
 * into `rest`, a number of cheers. `except` is a kind already shown
 * elsewhere with its count (the cheer button's own), left out of both. A
 * kind this build does not know is never drawn; it counts in `rest`.
 * Never who.
 */
export function foldCounts(
  cheers,
  { mine = null, except = null, top = TOP_KINDS } = {},
) {
  const all = cheerCounts(cheers).filter((c) => c.key !== except);
  const ranked = [...all].sort(
    (a, b) => b.count - a.count || CHEERS.indexOf(a) - CHEERS.indexOf(b),
  );
  const keep = new Set(ranked.slice(0, top).map((c) => c.key));
  if (mine && all.some((c) => c.key === mine)) keep.add(mine);
  const shown = ranked.filter((c) => keep.has(c.key));
  const left = except ? Number(cheers?.[except]) || 0 : 0;
  const rest =
    cheerTotal(cheers) - left - shown.reduce((n, c) => n + c.count, 0);
  return { shown, rest: Math.max(0, rest) };
}

/** How many cheered, in words, counts only: "You", "You and 2 others",
 *  "3 people". Never who. */
export function cheeredBy(cheers, mine) {
  const total = cheerTotal(cheers);
  if (total === 0) return "";
  const others = total - (mine ? 1 : 0);
  if (!mine) return `${total} ${total === 1 ? "person" : "people"}`;
  if (others === 0) return "You";
  return `You and ${others} ${others === 1 ? "other" : "others"}`;
}

/** The value a tap sends: the cheer, or null when it is already yours (a
 *  second tap on the same cheer takes it back). */
export const nextCheer = (mine, key) => (mine === key ? null : key);

/** An item as it reads after the person's cheer changes to `next`: the
 *  page shows it at once and puts the server's answer in its place. */
export function withMyCheer(item, next) {
  const cheers = { ...(item.cheers ?? {}) };
  const mine = item.my_cheer ?? null;
  if (mine) {
    cheers[mine] = (cheers[mine] ?? 1) - 1;
    if (cheers[mine] <= 0) delete cheers[mine];
  }
  if (next) cheers[next] = (cheers[next] ?? 0) + 1;
  return { ...item, cheers, my_cheer: next };
}

const RECENT_KEY = "elixir.cheer.recent";

/** Your most recent cheer from past the six, on this device only (a
 *  convenience: it takes the slot before More). Null when there is none
 *  or storage is closed. */
export function recentCheer() {
  try {
    const k = globalThis.localStorage?.getItem(RECENT_KEY) ?? null;
    return k && knownCheer(k) && CHEERS.indexOf(BY_KEY.get(k)) >= LEAD
      ? k
      : null;
  } catch {
    return null;
  }
}

/** Remembers a cheer from past the six as the recent one. */
export function rememberCheer(key) {
  if (!knownCheer(key) || CHEERS.indexOf(BY_KEY.get(key)) < LEAD) return;
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, key);
  } catch {
    // storage closed (a private window): nothing to remember
  }
}
