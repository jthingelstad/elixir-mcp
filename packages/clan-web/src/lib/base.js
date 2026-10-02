/**
 * Where Elixir Clan lives on Elixir's origin (one origin, 2026-09-28):
 * the site and docs own the root, the Console /console, and Clan this
 * prefix. Every Clan path is written with it, explicitly, rather than
 * through a router basepath: the kit's Link renders `to` as the href
 * verbatim, so a path without the prefix would be a broken link the
 * moment someone copied or middle-clicked it.
 */
export const CLAN = "/clan";

/** A pathname with the prefix taken off, so the route logic reads the
 *  section at the same index it always has: "/clan/you/away" is
 *  "/you/away", the bare prefix is "/". A path outside Clan is not the
 *  app's, and is null. */
export function appPath(pathname) {
  if (pathname === CLAN) return "/";
  return pathname.startsWith(`${CLAN}/`) ? pathname.slice(CLAN.length) : null;
}

/** The app's own pages. Their names come first under the prefix, where a
 *  clan's tag also goes, and they win: `/clan/verify` is the notice after
 *  sign-in, never a clan #VERIFY. */
const PAGES = new Set([
  "clans",
  "you",
  "refused",
  "verify",
  "feedback",
  "maintain",
]);

/** Whether a first segment under the prefix is where a clan's tag goes:
 *  anything but one of the app's own pages. */
export const isClanSegment = (segment) =>
  Boolean(segment) && !PAGES.has(segment);

/** The tag a first segment names, with its #, or null. Read the way the
 *  gate reads one (any case, O as 0, the game's alphabet), and never one
 *  of the app's own pages. */
export function tagOf(segment) {
  if (!isClanSegment(segment)) return null;
  const raw = segment.toUpperCase().replace(/O/g, "0");
  return /^[0289PYLQGRJCUV]{3,12}$/.test(raw) ? `#${raw}` : null;
}

/** A clan's page: the tag without its #. */
export const clanPath = (tag) => `${CLAN}/${String(tag).replace(/^#/, "")}`;
