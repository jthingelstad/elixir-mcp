import manifest from "./family.json" with { type: "json" };
import type { IconName } from "./Icon.tsx";

/**
 * The family, as the top bar knows it. ONE list, so the Eleventy build and the
 * app draw the same bar, tabs and footer.
 *
 * The list is family.json beside this file, the product manifest: this module
 * reads it for the React shell (apps/web/src/shell/Shell.jsx), and apps/site
 * reads the same file through its `familyBar` data file, so base.njk loops
 * over it instead of copying it. Adding a product is one edit there. A test in
 * apps/site pins both readers to that one file, and packages/mail tags a link
 * into any product it names.
 */

/** The wordmark beside the logo. The family is "Elixir"; the products
 *  are the places in it. */
export const FAMILY_WORDMARK: string = manifest.wordmark;

/** Where the family lives. Verticals prefix their hrefs with this; the
 *  Console and the static site are on it already and use bare paths. */
export const FAMILY_ORIGIN: string = manifest.origin;

/** The logo, a small webp the site build serves from /assets. */
export const FAMILY_LOGO: string = manifest.logo;

export interface FamilyProduct {
  /** The manifest's name for it. */
  key: string;
  label: string;
  href: string;
  icon: IconName;
  /** Opens in a new window: the game is a separate thing from the record. */
  external?: boolean;
  /** A game beside the record, not a place in it: drawn as the candy
   *  button on the right ("Play Drop"), never as a product tab. */
  game?: boolean;
  /** The game button's words, and what the game is, for its label. */
  action?: string;
  about?: string;
}

/** Every product, left to right, the game last. The one you are inside
 *  lights up green; the others are the way over. A product on the family
 *  origin is a `path` in the manifest and absolute here; one elsewhere
 *  is an `href`. Icons are names in Icon's set (a kit test renders each
 *  one). */
export const FAMILY_PRODUCTS: ReadonlyArray<FamilyProduct> =
  manifest.products.map((p) => ({
    key: p.key,
    label: p.label,
    href: p.href ?? `${FAMILY_ORIGIN}${p.path}`,
    icon: p.icon as IconName,
    ...(p.external ? { external: true } : {}),
    ...(p.game ? { game: true, action: p.action, about: p.about } : {}),
  }));

/** Where the bar's words lead, on this origin. */
export const FAMILY_PLACES = {
  signIn: manifest.signIn,
  createAccount: manifest.createAccount,
  settings: manifest.account.path,
  search: manifest.search,
  help: manifest.help,
  bell: manifest.bell,
};

export interface FamilyTab {
  key: string;
  label: string;
  /** On this origin. */
  path: string;
  icon: IconName;
  /** False for You, which the top bar draws as its avatar. */
  bar?: boolean;
}

/** The places a signed-in reader moves between, in order (slice 7, #765:
 *  Home, Find, Clan, You). The phone draws all four and the bell; the top
 *  bar draws all but You, which is its avatar. Stats is a product, not a
 *  tab: You leads to it. */
export const FAMILY_TABS: ReadonlyArray<FamilyTab> = manifest.tabs.map((t) => ({
  ...t,
  icon: t.icon as IconName,
}));

/** The bar's places for somebody signed out. */
export const FAMILY_SIGNED_OUT: { key: string; label: string; path: string }[] =
  manifest.signedOut;

/** The footer's links, in order, on every surface. */
export const FAMILY_FOOT: { label: string; path: string }[] = manifest.foot;

/** One recorded battle's public page, shown to somebody with no record
 *  yet so they can see what Elixir keeps before signing up: the home
 *  page and signed-out Ladder link it. A battle of the maintainer's own
 *  player (King Thing #20JJJ2CCRU, a war win on 2026-10-01); recorded
 *  history is kept indefinitely, so the link stays good. Change it here,
 *  the one place both halves read. */
export const FAMILY_SAMPLE_BATTLE: { label: string; path: string } = {
  label: manifest.sampleBattle.label,
  path: manifest.sampleBattle.path,
};

/** A family href with the origin taken off, for a surface that is on the
 *  family origin already (the app, the static site). */
export function onOrigin(href: string): string {
  return href.startsWith(`${FAMILY_ORIGIN}/`)
    ? href.slice(FAMILY_ORIGIN.length)
    : href;
}
