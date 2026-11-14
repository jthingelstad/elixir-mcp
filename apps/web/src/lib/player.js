import { HOME } from "./moved.js";
import { normTag, tagPath } from "./tag-url.js";

/**
 * The player page's addresses, in one place (slice 6, #764). Every player
 * name on the web opens one page (Jamie, 2026-11-12: "Yes, one page"); Stats
 * and Clan stay reachable from it. Mail and Discord lines build the same
 * address on the server (packages/mail render.mjs, packages/syndication
 * lines.mjs).
 *
 * Both live under /home, which the distribution already sends to this app:
 * a clean /player/<tag> would need a cache behaviour of its own, and the
 * distribution has none left [engineering, 2026-11-12].
 */
const PLAYER = `${HOME}/player`;
export const FOLLOW_ME = `${HOME}/follow`;

/** A player's page: the tag without its hash. */
export const playerHref = (tag) => `${PLAYER}/${tagPath(tag)}`;

/** A "Follow me in Elixir" link: the players' tags, comma-separated, and
 *  nothing else (DECISIONS "Invites carry no referral ids"). */
export const followMeHref = (tags) =>
  `${FOLLOW_ME}/${tags.map((t) => tagPath(t)).join(",")}`;

const TAG_SEGMENT = /^(?:%23|#)?[0-9A-Za-z]{3,12}$/;

/** The players a Follow me path names, as canonical tags; null when any part
 *  is not a tag, so a broken link says so rather than following part of it. */
export function tagsFromFollowPath(segment) {
  const parts = decodeURIComponent(String(segment ?? ""))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 50) return null;
  if (!parts.every((p) => TAG_SEGMENT.test(p))) return null;
  return [...new Set(parts.map((p) => normTag(p)))];
}

/** Whether a path is the player page or a Follow me link. */
export const isPlayerPath = (path) =>
  /^\/home\/(player|follow)\/[^/]+\/?$/.test(String(path ?? ""));
