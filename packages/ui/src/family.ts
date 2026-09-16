import type { IconName } from "./Icon.tsx";

/**
 * The family, as the top bar knows it. ONE list, so the Eleventy build,
 * the console and every vertical draw the same bar: the same wordmark,
 * the same tabs, the same product buttons on the right.
 *
 * apps/site/src/_includes/base.njk hand-mirrors this in Nunjucks (it
 * cannot import TypeScript); a test in apps/web pins the two together.
 */

/** The wordmark. The family is "Elixir"; the products are the buttons. */
export const FAMILY_WORDMARK = "Elixir";

/** Where the tabs live. Verticals prefix their hrefs with this; the
 *  console and the static site are on it already and use bare paths. */
export const FAMILY_ORIGIN = "https://elixir.poapkings.com";

/** The tabs, as [label, path]. Every one is a document apps/site builds. */
export const FAMILY_TABS: ReadonlyArray<readonly [string, string]> = [
  ["Home", "/"],
  ["Data", "/data"],
  ["Examples", "/examples/play"],
  ["Updates", "/updates"],
  ["Docs", "/docs"],
  ["Family", "/family"],
  ["Support", "/support"],
];

export interface FamilyProduct {
  key: "console" | "clan" | "drop";
  label: string;
  href: string;
  icon: IconName;
  /** Opens in a new window: the game is a separate thing from the record. */
  external?: boolean;
}

/** The product buttons, left to right. The one you are inside lights up
 *  green; the others are the way over. */
export const FAMILY_PRODUCTS: ReadonlyArray<FamilyProduct> = [
  {
    key: "console",
    label: "Console",
    href: `${FAMILY_ORIGIN}/account/overview`,
    icon: "gauge",
  },
  {
    key: "clan",
    label: "Clan",
    href: "https://clan.poapkings.com/",
    icon: "users",
  },
  {
    key: "drop",
    label: "Drop",
    href: "https://drop.poapkings.com/",
    icon: "droplet",
    external: true,
  },
];

/** The tabs with hrefs a vertical can use: absolute, back to the family
 *  home. `origin = ""` gives the console and the static site bare paths. */
export function familyTabs(origin = ""): { label: string; href: string }[] {
  return FAMILY_TABS.map(([label, path]) => ({
    label,
    href: `${origin}${path}`,
  }));
}
