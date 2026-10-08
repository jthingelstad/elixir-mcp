import manifest from "./family.json" with { type: "json" };
import type { IconName } from "./Icon.tsx";

/**
 * The family, as the top bar knows it. ONE list, so the Eleventy build,
 * the Console and every vertical draw the same bar: the logo and
 * wordmark home, the products on the left, Docs and the game on the
 * right, the account slot at the end (2026-09-29 canvas).
 *
 * The list is family.json beside this file, the product manifest: this
 * module reads it for the React kit, and apps/site reads the same file
 * through its `familyBar` data file, so base.njk loops over it instead
 * of copying it. Adding a product is one edit there. A test in
 * apps/site pins both readers to that one file, and packages/mail tags
 * a link into any product it names.
 *
 * The bar holds places, not pages: the static site's own pages (Home,
 * Data, Examples, Updates, Support) are the site's sub-nav and footer,
 * which apps/site keeps beside its templates.
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
  /** The manifest's name for it: what an app passes as Chrome's `current`. */
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

/** Docs: a top-level item of its own, on the right before the game. */
export const FAMILY_DOCS: FamilyProduct = {
  key: manifest.docs.key,
  label: manifest.docs.label,
  href: `${FAMILY_ORIGIN}${manifest.docs.path}`,
  icon: manifest.docs.icon as IconName,
};

/** The signed-out account slot: where "Sign in" leads. The Console's
 *  sign-in page, which forwards a reader who is already signed in to
 *  their console. */
export const FAMILY_SIGN_IN: { label: string; href: string; icon: IconName } = {
  label: manifest.signIn.label,
  href: `${FAMILY_ORIGIN}${manifest.signIn.path}`,
  icon: manifest.signIn.icon as IconName,
};

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

/** What the game button says to a screen reader: what it is, and that it
 *  leaves for another host in a new window. */
export function gameLabel(p: FamilyProduct): string {
  const host = new URL(p.href).host;
  return `${p.action ?? p.label}, ${p.about ?? "a game"} (opens ${host} in a new window)`;
}

/** A family href with the origin taken off, for a surface that is on the
 *  family origin already (the Console, the static site). */
export function onOrigin(href: string): string {
  return href.startsWith(`${FAMILY_ORIGIN}/`)
    ? href.slice(FAMILY_ORIGIN.length)
    : href;
}
