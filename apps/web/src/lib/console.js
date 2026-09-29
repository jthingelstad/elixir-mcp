/**
 * Where the Console lives on the one origin (2026-09-28): the site and
 * docs own the root, the Console owns this prefix, and Elixir Clan and
 * Ladder take their own beside it. Every Console path is written with
 * it, explicitly, rather than through a router basepath: the kit's Link
 * renders `to` as the href verbatim, so a path without the prefix would
 * be a broken link the moment someone copied or middle-clicked it.
 */
export const CONSOLE = "/console";

/** A pathname with the prefix taken off, so the route logic reads the
 *  section at the same index it always has: "/console/account/usage" is
 *  "/account/usage", the bare prefix is "/". A path outside the Console
 *  is not the app's, and is null. */
export function appPath(pathname) {
  if (pathname === CONSOLE) return "/";
  return pathname.startsWith(`${CONSOLE}/`)
    ? pathname.slice(CONSOLE.length)
    : null;
}
