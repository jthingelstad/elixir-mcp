/**
 * Clan's pages in Elixir's Tinylytics report. The app's loader and route
 * bridge (../analytics.js) report a /clan path through `analyticsLocation`
 * below. Nothing personal is sent: a CR tag is a public game identifier,
 * and even that rides as a query attribute, never as the path, so the
 * report reads as pages and not as one row per clan.
 */
import { CLAN, appPath, tagOf } from "./lib/base.js";

const LOCAL = ["localhost", "127.0.0.1", "::1"];
const MEMBERS_PAGES = new Set([
  "me",
  "standing",
  "review",
  "map",
  "recruit",
  "scout",
  "away",
]);

/**
 * The page a path is, for the report. `/clan/2PQRJ8LV/members/review` is the
 * page `/clan/members/review` of clan 2PQRJ8LV; `/clan/2PQRJ8LV/actions/37`
 * is the page `/clan/actions/detail` of action 37; `/clan/feedback/abc123`
 * is the page `/clan/feedback` of item abc123; `/clan` is the landing.
 * Segments are read under the prefix, where the app's own pages
 * (`/clan/verify`) are never a tag, and the page is reported with it.
 * Query strings (`?error=`) never ride along.
 */
export function analyticsLocation(
  pathname = window.location.pathname,
  origin = window.location.origin,
) {
  // The app only runs under /clan; any other path is read as it stands.
  const app = appPath(pathname);
  const base = app === null ? "" : CLAN;
  const segments = (app ?? pathname).split("/").filter(Boolean);
  const url = new URL("/", origin);
  let page = base || "/";
  const tag = app === null ? null : tagOf(segments[0]);
  if (tag) {
    url.searchParams.set("clan", tag);
    const rest = segments.slice(1);
    if (rest[0] === "actions" && /^[0-9]+$/.test(rest[1] ?? "")) {
      url.searchParams.set("id", rest[1]);
      rest[1] = "detail";
    }
    if (["standings", "war"].includes(rest[0]) && rest[1])
      url.searchParams.set("id", rest.pop());
    // A member's page is one page, whoever it is; Members' own pages are not.
    if (rest[0] === "members" && rest[1] && !MEMBERS_PAGES.has(rest[1]))
      rest[1] = "detail";
    page = `${CLAN}${rest.length ? `/${rest.join("/")}` : ""}`;
  } else if (
    (segments[0] === "feedback" && segments[1]) ||
    (segments[0] === "maintain" && segments[1] === "feedback" && segments[2])
  ) {
    const id = segments.pop();
    page = `${base}/${segments.join("/")}`;
    url.searchParams.set("id", id);
  } else if (segments.length) {
    page = `${base}/${segments.join("/")}`;
  }
  url.pathname = page;
  return { path: page, url: url.toString() };
}

/**
 * A product event, as Tinylytics counts them: a click on a
 * data-tinylytics-event node, so a programmatic event is a hidden node
 * clicked once. `value` is a bounded label (a card type and status, a
 * category, a route key), never free text, a tag or a URL. The list is in
 * this package's AGENTS.md; add there when adding here.
 */
export function trackEvent(event, value) {
  try {
    if (LOCAL.includes(window.location.hostname)) return;
    const node = document.createElement("button");
    node.type = "button";
    node.hidden = true;
    node.setAttribute("data-tinylytics-event", event);
    if (value) node.setAttribute("data-tinylytics-event-value", value);
    document.body.appendChild(node);
    node.click();
    node.remove();
  } catch {
    // Never turn one failure into two.
  }
}

/** The route key a failure reports: method and path with ids and tags as
 *  `*`. The server's own line names the same route without its mount
 *  (`/api/clans/*`); the key keeps `/api/clan`, so on the site Clan
 *  shares with the Console its failures never read as the Console's. */
export function routeLabel(method, path) {
  const generic = path
    .replace(/^\/api\/clan\/clans\/[0-9A-Za-z]+/, "/api/clan/clans/*")
    .replace(/\/(actions|notes|holds|members)\/[^/]+/g, "/$1/*")
    .replace(/\/awards\/grants\/.+$/, "/awards/grants/*")
    .replace(/^(\/api\/clan\/(?:maintain\/)?feedback)\/[^/]+$/, "$1/*")
    .replace(/\?.*$/, "");
  return `${method} ${generic}`;
}
