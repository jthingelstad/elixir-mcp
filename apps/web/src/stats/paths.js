/**
 * Stats' addresses (Ladder until 2026-11-12), with no imports, so the
 * site's tests read them without the kit. `stats.js` re-exports them for
 * the section.
 */

/** Ladder is You's Stats tab since 2026-11-12 (Jamie's go: "You with
 *  Stats"). Its old address, `/ladder`, stopped forwarding on 2026-11-13. */
export const STATS = "/home/you/stats";
/** The pages, in tab order. `slug` "season" is the bare STATS. */
export const STATS_PAGES = [
  { slug: "season", label: "Season", icon: "chart-line" },
  { slug: "battles", label: "Battles", icon: "calendar-days" },
  { slug: "decks", label: "Decks", icon: "layers" },
  { slug: "cards", label: "Cards", icon: "gallery-horizontal-end" },
];
