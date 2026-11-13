import { CLAN, appPath, tagOf } from "../clan/lib/base.js";

/**
 * The addresses that forward, read by the root route (and the server
 * render, which runs the same beforeLoad), so the query and the fragment
 * ride along.
 *
 * Only addresses Elixir still sends forward (2026-11-13). The old Console,
 * Ladder, account, Explore and Clan tab addresses went: Jamie, 2026-11-13,
 * "It is fine to break url support." What stays is a clan's own address and
 * its Actions list, which Clan's Discord posts and Actions mail name, and
 * both now open the clan's Feed.
 */

export const SIGN_IN = "/signin";
export const HOME = "/home";

/** Where a pathname now lives, or null when it stays put. A trailing slash
 *  means the same address. */
export function movedTo(pathname) {
  const app = appPath(
    pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname,
  );
  if (app === null) return null;
  const [, segment, section, rest] = app.split("/");
  if (!tagOf(segment) || rest !== undefined) return null;
  // `/clan/<tag>`: the clan's own address. `/clan/<tag>/actions`: an
  // Action that has no number, as Clan's Discord posts link it. One
  // Action keeps its own page, `/clan/<tag>/actions/<n>`.
  if (section === undefined || section === "actions")
    return `${CLAN}/${segment}/feed`;
  return null;
}
