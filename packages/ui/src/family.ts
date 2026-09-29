import manifest from "./family.json" with { type: "json" };
import type { IconName } from "./Icon.tsx";

/**
 * The family, as the top bar knows it. ONE list, so the Eleventy build,
 * the console and every vertical draw the same bar: the same wordmark,
 * the same tabs, the same product buttons on the right.
 *
 * The list is family.json beside this file, the product manifest: this
 * module reads it for the React kit, and apps/site reads the same file
 * through its `familyBar` data file, so base.njk loops over it instead
 * of copying it. Adding a product (or a tab) is one edit there. A test
 * in apps/site pins both readers to that one file.
 */

/** The wordmark. The family is "Elixir"; the products are the buttons. */
export const FAMILY_WORDMARK: string = manifest.wordmark;

/** Where the tabs live. Verticals prefix their hrefs with this; the
 *  console and the static site are on it already and use bare paths. */
export const FAMILY_ORIGIN: string = manifest.origin;

/** The tabs, as [label, path]. Every one is a document apps/site builds. */
export const FAMILY_TABS: ReadonlyArray<readonly [string, string]> =
  manifest.tabs.map((t) => [t.label, t.path] as const);

export interface FamilyProduct {
  /** The manifest's name for it: what an app passes as Chrome's `current`. */
  key: string;
  label: string;
  href: string;
  icon: IconName;
  /** Opens in a new window: the game is a separate thing from the record. */
  external?: boolean;
}

/** The product buttons, left to right. The one you are inside lights up
 *  green; the others are the way over. A product on the family origin is
 *  a `path` in the manifest and absolute here; one elsewhere is an `href`.
 *  Icons are names in Icon's set (a kit test renders each one). */
export const FAMILY_PRODUCTS: ReadonlyArray<FamilyProduct> =
  manifest.products.map((p) => ({
    key: p.key,
    label: p.label,
    href: p.href ?? `${FAMILY_ORIGIN}${p.path}`,
    icon: p.icon as IconName,
    ...(p.external ? { external: true } : {}),
  }));

/** The tabs with hrefs a vertical can use: absolute, back to the family
 *  home. `origin = ""` gives the console and the static site bare paths. */
export function familyTabs(origin = ""): { label: string; href: string }[] {
  return FAMILY_TABS.map(([label, path]) => ({
    label,
    href: `${origin}${path}`,
  }));
}
