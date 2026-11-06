import { clanMoved } from "@elixir-mcp/clan-web/lib/moved.js";

/**
 * Every address that moved, and every partial address that means a page: the
 * one map (redesign step 3b, 2026-11-06). The root route reads it and nothing
 * else redirects, so a link in archived mail, a bookmark and a return path
 * all land the same way.
 *
 * Mail already in inboxes carries these addresses for as long as mail is
 * kept, so an entry leaves only when no archived mail can name it.
 *
 * Redirects are in the client (the root route's beforeLoad, which the server
 * render runs too), so they cost no CloudFront behaviour. The query and the
 * fragment ride along: `?signup`, `?return_to=` and a magic link's
 * `#login_token=` still arrive.
 */
import { CONSOLE } from "./console.js";

export const SERVICE_STATUS = "/data/service";
export const SIGN_IN = "/signin";
export const HOME = "/home";

export const REDIRECTS = {
  // Home took over from Overview and the Console's Timeline.
  [CONSOLE]: HOME,
  [`${CONSOLE}/account`]: HOME,
  [`${CONSOLE}/account/overview`]: HOME,
  [`${CONSOLE}/account/timeline`]: `${HOME}/timeline`,
  // The bare Activity path was the timeline until 2026-09-23, and links to it
  // still mean that.
  [`${CONSOLE}/account/activity`]: `${HOME}/timeline`,
  [`${CONSOLE}/signin`]: SIGN_IN,
  [`${CONSOLE}/status`]: SERVICE_STATUS,
  [`${CONSOLE}/status/service`]: SERVICE_STATUS,
  // Partial addresses: a bare section to its first page, a partial record
  // path to the lookup.
  [`${CONSOLE}/admin`]: `${CONSOLE}/admin/requests`,
  [`${CONSOLE}/explore/player`]: `${CONSOLE}/explore`,
  [`${CONSOLE}/explore/clan`]: `${CONSOLE}/explore`,
  // Ladder's Days played became Battles; the calendar moved to Season.
  "/ladder/days": "/ladder/battles",
};

/** Where a pathname now lives, or null when it stays put. A trailing slash
 *  means the same address. */
export function movedTo(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return REDIRECTS[path] ?? clanMoved(path);
}
