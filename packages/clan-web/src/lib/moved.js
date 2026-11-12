/**
 * Every Clan address that moved: when the rail became five tabs (redesign
 * step 4, 2026-11-06), and when the five became Clan as one view (slice 8,
 * 2026-11-12: Today to Feed, Season to War, Awards to Standings, Decided
 * into Run), and when Members' row went (G6, 2026-11-12: Standing to
 * Standings, Review into Run). `apps/web/src/lib/moved.js` asks this after its own map, so
 * the root route is still the one place a redirect happens: a link in archived
 * mail, a bookmark and a return path all land the same way, and the query and
 * the fragment ride along.
 *
 * Mail already in inboxes carries these for as long as mail is kept, so an
 * entry leaves only when no archived mail can name it.
 *
 * A clan's own address is its Feed for everyone (A12, as one view). Two old addresses need the
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
  standing: "standings",
  trophies: "standings",
  recruit: "members/recruit",
  map: "members/map",
  discord: "run/discord",
};
const MANAGE = {
  inbox: "feed",
  board: "run/review",
  history: "run/decided",
  policy: "run/about",
  settings: "run/settings",
  model: "run/model-voice",
  scout: "members/scout",
  awards: "standings",
};
/** Members' row of pages, cleared on 2026-11-12 (G6): Standing is on
 *  Standings, Review in Run. Recruit and Scout stay addresses Clan's shell
 *  answers, since where they open depends on the session (App.jsx). */
const MEMBERS = { standing: "standings", review: "run/review" };
/** The five tabs' sections that became a tab of one view, keeping the page
 *  under them (a week, a season). Today's Decided is the leaders', in Run. */
const RENAMED = { season: "war", week: "war", awards: "standings" };

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
  if (!section) return at("feed");
  if (section === "actions") return tab ? null : at("feed");
  if (section === "today")
    return at(tab === "decided" ? "run/decided" : "feed");
  if (section === "manage") return tab ? at(MANAGE[tab] ?? "feed") : at("feed");
  if (section === "members") return MEMBERS[tab] ? at(MEMBERS[tab]) : null;
  if (RENAMED[section])
    return at(tab ? `${RENAMED[section]}/${tab}` : RENAMED[section]);
  const moved = SECTIONS[section];
  if (!moved) return null;
  return at(moved);
}
