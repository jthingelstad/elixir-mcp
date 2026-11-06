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
import { SETTINGS } from "./settings.js";

export const SERVICE_STATUS = "/data/service";
export const SIGN_IN = "/signin";
export const HOME = "/home";

export const REDIRECTS = {
  // Home took over from Overview and the Console's Timeline.
  [CONSOLE]: HOME,
  [`${CONSOLE}/account`]: HOME,
  [`${CONSOLE}/account/overview`]: HOME,
  // Settings' pages, under their own prefix since step 6.
  [`${CONSOLE}/account/profile`]: `${SETTINGS}/profile`,
  [`${CONSOLE}/account/profile/email`]: `${SETTINGS}/emails`,
  [`${CONSOLE}/account/profile/devices`]: `${SETTINGS}/sign-ins`,
  [`${CONSOLE}/account/activity/events`]: `${SETTINGS}/sign-ins`,
  [`${CONSOLE}/account/activity/emails`]: `${SETTINGS}/emails/sent`,
  [`${CONSOLE}/account/activity/requests`]: `${SETTINGS}/usage/requests`,
  [`${CONSOLE}/account/tracking`]: `${SETTINGS}/players`,
  [`${CONSOLE}/account/verify`]: `${SETTINGS}/players/verify`,
  [`${CONSOLE}/account/usage`]: `${SETTINGS}/usage`,
  [`${CONSOLE}/account/connections`]: `${SETTINGS}/connections`,
  [`${CONSOLE}/account/agents`]: `${SETTINGS}/connections`,
  [`${CONSOLE}/account/feedback`]: `${SETTINGS}/feedback`,
  [`${CONSOLE}/agent`]: `${SETTINGS}/connections`,
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
export function movedTo(pathname, hash = "") {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (
    path === `${CONSOLE}/account/connections` &&
    hash.replace(/^#/, "") === "timeline-discord"
  )
    return `${SETTINGS}/connections/discord`;
  return (
    REDIRECTS[path] ?? clanMoved(path) ?? accountMoved(path) ?? agentMoved(path)
  );
}

/** Your own account's pages (redesign step 6), every one of which mail, a
 *  bookmark or a return path may still name. Static ones are in REDIRECTS;
 *  these carry an id. */
function accountMoved(path) {
  if (path === `${CONSOLE}/status/collectors/new`)
    return `${SETTINGS}/collectors/new`;
  const prefix = `${CONSOLE}/account/`;
  if (!path.startsWith(prefix)) return null;
  const [page, a, b, c] = path.slice(prefix.length).split("/");
  if (page === "tracking" && a && !b) return `${SETTINGS}/players/${a}`;
  if (page === "feedback" && a && !b) return `${SETTINGS}/feedback/${a}`;
  if (page === "agents" && a && !b) return `${SETTINGS}/agents/${a}`;
  if (page === "activity" && a === "c" && b && !c)
    return `${SETTINGS}/usage/requests/${b}`;
  if (page === "activity" && a === "e" && b && !c)
    return `${SETTINGS}/emails/${b}`;
  // A page that went long ago: Home, as it always was.
  return HOME;
}

/** An agent's old console, one page per rail row, to its tabs. */
function agentMoved(path) {
  const prefix = `${CONSOLE}/agent/`;
  if (!path.startsWith(prefix)) return null;
  const [id, page, a, b] = path.slice(prefix.length).split("/");
  if (!id) return `${SETTINGS}/connections`;
  const at = (rest) => `${SETTINGS}/agents/${id}/${rest}`;
  if (page === "tracking") return at("reads");
  if (page === "activity") {
    if (a === "c" && b) return at(`usage/requests/${b}`);
    return at(a === "events" ? "usage/events" : "usage/requests");
  }
  if (page === "feedback") return at(a ? `feedback/${a}` : "feedback");
  if (["timeline", "usage", "connections", "settings"].includes(page))
    return at(page);
  return at("overview");
}
