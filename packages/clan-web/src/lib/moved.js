/**
 * Every Clan address that moved when the rail became five tabs (redesign step
 * 4, 2026-11-06). `apps/web/src/lib/moved.js` asks this after its own map, so
 * the root route is still the one place a redirect happens: a link in archived
 * mail, a bookmark and a return path all land the same way, and the query and
 * the fragment ride along.
 *
 * Mail already in inboxes carries these for as long as mail is kept, so an
 * entry leaves only when no archived mail can name it.
 *
 * A clan's own address is Today for everyone (A12). Two old addresses need the
 * session to know where they go, so Clan's shell answers them instead:
 * `/clan/you` and `/clan/you/away` (the selected clan is the person's to name)
 * and `/members/me` (the player is theirs).
 */
import { CLAN, appPath, tagOf } from "./base.js";

/** Under `/clan/<TAG>`: old section, optional old tab, to the new page. A
 *  section's own tab that is not listed is not an address the rail ever
 *  linked, and goes to the section's page. */
const SECTIONS = {
  roster: "members",
  me: "members/me",
  week: "season",
  standing: "members/standing",
  trophies: "awards",
  recruit: "members/recruit",
  map: "members/map",
  discord: "run/discord",
};
const MANAGE = {
  inbox: "today",
  board: "members/review",
  history: "today/decided",
  policy: "run/about",
  settings: "run/settings",
  model: "run/model-voice",
  scout: "members/scout",
  awards: "awards",
};

/** Where a Clan pathname now lives, or null when it stays put. */
export function clanMoved(pathname) {
  const app = appPath(pathname);
  if (app === null) return null;
  const m = /^\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(
    app.length > 1 ? app.replace(/\/$/, "") : app,
  );
  if (!m || !tagOf(m[1])) return null;
  const [, tag, section, tab] = m;
  const at = (page) => `${CLAN}/${tag}/${page}`;
  if (!section) return at("today");
  if (section === "actions") return tab ? null : at("today");
  if (section === "manage")
    return tab ? at(MANAGE[tab] ?? "today") : at("today");
  if (section === "week") return at(tab ? `season/${tab}` : "season");
  const moved = SECTIONS[section];
  if (!moved) return null;
  return at(moved);
}
