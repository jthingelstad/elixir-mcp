/**
 * Stats' addresses (Ladder until 2026-11-12), with no imports, so the
 * redirect map (`lib/moved.js`) and the site's tests read them without the
 * kit. `ladder.js` re-exports them for the section.
 */

/** Ladder is You's Stats tab since 2026-11-12 (Jamie's go: "You with
 *  Stats"); its old address, `/ladder`, redirects here (lib/moved.js). */
export const LADDER = "/home/you/stats";
/** Where Ladder used to be: every path under it still lands (moved.js). */
const OLD_LADDER = "/ladder";

/** The pages, in tab order. `slug` "season" is the bare LADDER. */
export const LADDER_PAGES = [
  { slug: "season", label: "Season", icon: "chart-line" },
  { slug: "battles", label: "Battles", icon: "calendar-days" },
  { slug: "decks", label: "Decks", icon: "layers" },
  { slug: "cards", label: "Cards", icon: "gallery-horizontal-end" },
];

/** Where an old Ladder address now lives, or null for any other path: the
 *  same page under You's Stats; Days played became Battles (2026-11-06); a
 *  page Ladder never had is the season. */
export function ladderMoved(path) {
  if (path !== OLD_LADDER && !path.startsWith(`${OLD_LADDER}/`)) return null;
  const [, , page = ""] = path.split("/");
  if (page === "days") return `${LADDER}/battles`;
  return LADDER_PAGES.some((p) => p.slug === page) && page !== "season"
    ? `${LADDER}/${page}`
    : LADDER;
}
