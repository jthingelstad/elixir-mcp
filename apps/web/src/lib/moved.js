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
import { LADDER, ladderMoved } from "../ladder/paths.js";
import { ADMIN, SETTINGS } from "./settings.js";
import { normTag, tagPath } from "./tag-url.js";

/** The public status page, a site document. */
const PUBLIC_STATUS = "/data";
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
  [`${CONSOLE}/account/timeline`]: HOME,
  // The bare Activity path was the timeline until 2026-09-23, and links to it
  // still mean that.
  [`${CONSOLE}/account/activity`]: HOME,
  // Home was three tabs until slice 7 (#765): it is one feed now. Mail names
  // both old tabs: the timeline is the feed, and Friends' follow form moved
  // to Find [engineering, 2026-11-12].
  [`${HOME}/timeline`]: HOME,
  [`${HOME}/friends`]: `${HOME}/find`,
  [`${CONSOLE}/signin`]: SIGN_IN,
  // The Console folded (Jamie, 2026-11-12). The service page, the fleet and
  // Efficiency are Admin's; everyone else reads the public status page, which
  // credits each collector to its operator. One collector's page is
  // Settings' (accountMoved).
  "/data/service": PUBLIC_STATUS,
  [`${CONSOLE}/status`]: PUBLIC_STATUS,
  [`${CONSOLE}/status/service`]: PUBLIC_STATUS,
  [`${CONSOLE}/status/collectors`]: PUBLIC_STATUS,
  [`${CONSOLE}/status/efficiency`]: `${ADMIN}/efficiency`,
  [`${CONSOLE}/admin`]: `${ADMIN}/requests`,
  // The in-app charts joined the site's Status and data page (step 7).
  [`${CONSOLE}/data`]: "/data",
  [`${CONSOLE}/data/dashboard`]: "/data",
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
    REDIRECTS[path] ??
    clanMoved(path) ??
    // Ladder became You's Stats tab (2026-11-12): every old Ladder address,
    // mail's `/ladder?player=` and `/ladder?season=` among them.
    ladderMoved(path) ??
    accountMoved(path) ??
    agentMoved(path) ??
    adminMoved(path) ??
    consoleMoved(path)
  );
}

/** Admin under Settings (2026-11-12): every Admin address, its record ids
 *  with it. Staff mail and alerts name these. */
function adminMoved(path) {
  const prefix = `${CONSOLE}/admin/`;
  return path.startsWith(prefix)
    ? `${ADMIN}/${path.slice(prefix.length)}`
    : null;
}

/** The Console's last pages (2026-11-12): /console only redirects. What has
 *  no page of its own now lands on Home, so no old link is "Nothing at this
 *  address". */
function consoleMoved(path) {
  if (path === CONSOLE || !path.startsWith(`${CONSOLE}/`)) return null;
  const [section, page, id] = path.slice(CONSOLE.length + 1).split("/");
  if (section === "status" && page === "collectors" && id)
    return `${SETTINGS}/collectors/${id}`;
  if (section === "explore") return exploreMoved(page, id);
  return HOME;
}

const FIND = `${HOME}/find`;
const CLAN_DIRECTORY = "/clan/directory";
const TAG_SEGMENT = /^(?:%23|#)?[0-9A-Za-z]{3,12}$/;

/** A tag from an old record address, as a path segment; null when it is not
 *  one, so a broken link lands on Find rather than a guess. */
function tagSegment(raw) {
  if (!TAG_SEGMENT.test(raw ?? "")) return null;
  return tagPath(normTag(decodeURIComponent(raw)));
}

/** Explore folded (Jamie, 2026-11-12). Its lookup and Players browse are
 *  Find; a player's record and profile are the player page (its Record
 *  tab); a battle's is the battle page; a clan's is the clan's own address,
 *  which opens Clan for its members and the clan directory, searched for
 *  it, for anyone else (Clan's shell decides, since only the session
 *  knows); a war week is that week of the clan's War tab
 *  (`/war/<season>-<n>`); decks are Stats' Decks. Mail and Discord lines in
 *  inboxes name these. */
function exploreMoved(page, id) {
  const player = (raw) => {
    const tag = tagSegment(raw);
    return tag ? `${HOME}/player/${tag}` : FIND;
  };
  if (!page || page === "players" || page === "clans") return FIND;
  if (page === "meta" || page === "deck") return `${LADDER}/decks`;
  if (page === "weeks") return "/clan";
  if (page === "player" || page === "profile") return player(id);
  if (page === "clan") {
    const tag = tagSegment(id);
    return tag ? `/clan/${tag}/feed` : CLAN_DIRECTORY;
  }
  if (page === "battle")
    return /^[0-9a-f]{12,64}$/.test(id ?? "") ? `/battle/${id}` : HOME;
  if (page === "week") {
    // <clan>~<season>~<section>: that week of the clan's War tab, counted
    // from 1 there; its season when the section is not a number.
    const [raw, season, section] = String(id ?? "").split("~");
    const tag = tagSegment(raw);
    if (!tag) return "/clan";
    if (!/^\d{1,4}$/.test(season ?? "")) return `/clan/${tag}/war`;
    return /^\d{1,2}$/.test(section ?? "")
      ? `/clan/${tag}/war/${season}-${Number(section) + 1}`
      : `/clan/${tag}/war/${season}`;
  }
  if (page === "list") {
    const [kind, rest] = String(id ?? "").split(":");
    if (kind === "battles" || kind === "decks") return player(rest);
    if (kind === "deckbattles") return `${LADDER}/decks`;
    if (kind === "members") {
      const tag = tagSegment(rest);
      return tag ? `/clan/${tag}/members` : CLAN_DIRECTORY;
    }
    if (kind === "weeks") {
      const tag = tagSegment(rest);
      return tag ? `/clan/${tag}/war` : "/clan";
    }
  }
  return FIND;
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
