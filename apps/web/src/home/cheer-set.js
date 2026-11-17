/**
 * The six cheers (Jamie, 2026-11-12: "Yes, six cheers (Recommended)"; the
 * design canvas's set): every one celebrates, so there is no thumbs-down
 * or sad face. The keys are the server's (services/web-api/src/cheers.mjs,
 * 0243); a test pins the two lists together.
 *
 * Each is drawn with one Lucide glyph (2026-11-17, "Lucide is the glyph
 * library"), the emoji they had before retired: this list is the one map
 * from a kind to its glyph, and every place that shows a kind draws it
 * through <CheerGlyph> (CheerGlyph.jsx), so a kind looks the same on the feed, a session's
 * page, a battle's page and the bell. Mail, push, Discord, RSS and MCP
 * keep their words. The first is the default: one tap gives it.
 */
export const CHEERS = [
  { key: "well_played", icon: "thumbs-up", label: "Well played" },
  { key: "on_fire", icon: "flame", label: "On fire" },
  { key: "royal", icon: "crown", label: "Royal" },
  { key: "wow", icon: "sparkles", label: "Wow" },
  { key: "ha", icon: "laugh", label: "Ha" },
  { key: "grind", icon: "biceps-flexed", label: "Grind" },
];

/** The cheer one tap gives (2026-11-17, "A cheer is one tap"). */
export const DEFAULT_CHEER = CHEERS[0].key;

const BY_KEY = new Map(CHEERS.map((c) => [c.key, c]));

/** A kind as its words and glyph, the default's for an unknown key. */
export const cheerOf = (key) => BY_KEY.get(key) ?? CHEERS[0];

/** The cheers an item has, in the picker's order, with their counts. */
export const cheerCounts = (cheers) =>
  CHEERS.filter((c) => (cheers?.[c.key] ?? 0) > 0).map((c) => ({
    ...c,
    count: cheers[c.key],
  }));

/** How many cheered, in words, counts only: "You", "You and 2 others",
 *  "3 people". Never who. */
export function cheeredBy(cheers, mine) {
  const total = Object.values(cheers ?? {}).reduce((n, v) => n + v, 0);
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
