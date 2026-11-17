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
 *
 * And Home's own address (2026-11-17): the feed is the Timeline, at
 * `/timeline`, and `/home` forwards there for good (mail already sent,
 * Discord posts, bookmarks, the installed app's old start URL). Every
 * other page under `/home/` keeps its address: Find, Profile (`/home/you`),
 * a player, a session, an account (DECISIONS "Timeline, Profile and
 * Notifications"). The web API sends the same 301 before this runs
 * (services/web-api/src/app-pages.mjs); this is the fallback for an
 * address the router reaches without a request.
 */

export const SIGN_IN = "/signin";
/** The prefix the pages under Home keep: Find, Profile, players, sessions,
 *  accounts. Not a page of its own any more. */
export const HOME = "/home";
/** The feed, the Timeline tab (2026-11-17). */
export const TIMELINE = "/timeline";

/** Where a pathname now lives, or null when it stays put. A trailing slash
 *  means the same address. */
export function movedTo(pathname) {
  if (pathname === HOME || pathname === `${HOME}/`) return TIMELINE;
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
