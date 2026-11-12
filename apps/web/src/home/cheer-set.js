/**
 * The six cheers (Jamie, 2026-11-12: "Yes, six cheers (Recommended)"; the
 * design canvas's set): every one celebrates, so there is no thumbs-down
 * or sad face. The keys are the server's (services/web-api/src/cheers.mjs,
 * 0243); a test pins the two lists together.
 */
export const CHEERS = [
  { key: "well_played", emoji: "👏", label: "Well played" },
  { key: "on_fire", emoji: "🔥", label: "On fire" },
  { key: "royal", emoji: "👑", label: "Royal" },
  { key: "wow", emoji: "😮", label: "Wow" },
  { key: "ha", emoji: "😂", label: "Ha" },
  { key: "grind", emoji: "💪", label: "Grind" },
];

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
