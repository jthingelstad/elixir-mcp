/**
 * Clan's five tabs (structure.md, redesign step 4): Today, Members, Season,
 * Awards and, for the leader and co-leaders, Run. The tabs replace the rail;
 * what used to be a rail item is a page under one of them. This is only what
 * goes on them and which one a path is on.
 *
 * Who sees what:
 * - Today, Members, Season and Awards are every member's, at any size, with
 *   or without a policy. Each page says what waits on a policy.
 * - Run is for a verified leader or co-leader, with or without a policy.
 * - Inside Members: Review for a verified leader or co-leader, Scout also for
 *   elders, Map for verified members while the clan keeps it on, Recruit for
 *   every member (A11).
 */
import { appPath, clanPath, tagOf } from "./base.js";

const LEADERS = new Set(["leader", "coLeader"]);
const ELDER_PLUS = new Set(["leader", "coLeader", "elder"]);

/** Whether a clan entry is led by the person: leader or co-leader, as
 *  verified. An unverified player is a member here, whatever its role in the
 *  game. */
export const leads = (clan) =>
  Boolean(clan) && clan.verified !== false && LEADERS.has(clan.role);

/** An elder, co-leader or leader, as verified. */
export const eldersUp = (clan) =>
  Boolean(clan) && clan.verified !== false && ELDER_PLUS.has(clan.role);

/** Whether the selected clan's policy is active: saved, on a clan of at
 *  least 10 (an older /api/me without the flag reads as its `set`). */
export const policyActive = (me) =>
  me?.policy?.active ?? me?.policy?.set === true;

/** The Actions waiting for this person in the selected clan, as who they
 *  are there; none while the policy is not active. */
export const waitingFor = (me) =>
  policyActive(me) ? Number(me.open_actions ?? 0) : 0;

/** The tabs, in order, for the selected clan. Today's count is attention: the
 *  actions waiting for you. */
export function clanTabs(me) {
  const clan = me?.selected ?? null;
  if (!clan) return [];
  const base = clanPath(clan.clan_tag);
  const waiting = waitingFor(me);
  const tabs = [
    {
      key: "today",
      label: "Today",
      href: `${base}/today`,
      count: waiting || null,
      countLabel: "waiting for you",
    },
    { key: "members", label: "Members", href: `${base}/members` },
    { key: "season", label: "Season", href: `${base}/season` },
    { key: "awards", label: "Awards", href: `${base}/awards` },
  ];
  if (leads(clan)) tabs.push({ key: "run", label: "Run", href: `${base}/run` });
  return tabs;
}

/** Members' pages, as chips (the main row) and buttons (the side), for this
 *  person. The Map chip goes when the clan turned it off or the player is not
 *  verified; its address then explains. */
export function membersPages(me) {
  const clan = me?.selected ?? null;
  if (!clan) return { chips: [], side: [] };
  const base = `${clanPath(clan.clan_tag)}/members`;
  const chips = [
    { key: "roster", label: "Roster", to: base },
    { key: "standing", label: "Standing", to: `${base}/standing` },
  ];
  if (leads(clan))
    chips.push({ key: "review", label: "Review", to: `${base}/review` });
  if (clan.verified !== false && me?.social?.enabled !== false)
    chips.push({ key: "map", label: "Map", to: `${base}/map` });
  const side = [{ key: "recruit", label: "Recruit", to: `${base}/recruit` }];
  if (eldersUp(clan))
    side.push({ key: "scout", label: "Scout", to: `${base}/scout` });
  return { chips, side };
}

/** `/clan/<TAG>/<section>[/<tab>]` as its parts, or null. */
function parts(path) {
  const m = /^\/([^/]+)(?:\/([a-z]+)(?:\/([a-z0-9-]+))?)?\/?$/i.exec(
    appPath(path) ?? "",
  );
  if (!m || !tagOf(m[1])) return null;
  return { section: m[2] ?? null, tab: m[3] ?? null };
}

/** Which tab a path is on. An action's own page is under Today. */
export function tabOf(path) {
  const p = parts(path);
  if (!p) return null;
  if (p.section === "actions") return "today";
  return ["today", "members", "season", "awards", "run"].includes(p.section)
    ? p.section
    : null;
}

const MEMBER_PAGES = new Set([
  "standing",
  "review",
  "map",
  "recruit",
  "scout",
  "away",
]);

/** The page a path is, in a word, for feedback that rides along: never a tag
 *  or a number, only what kind of page it was on. */
export function pageOf(path) {
  const app = appPath(path) ?? "";
  if (app === "/clans" || app === "/") return "clans";
  const p = parts(path);
  if (!p) return null;
  if (p.section === "actions") return p.tab ? "action" : "today";
  if (p.section === "members") {
    if (!p.tab) return "roster";
    return MEMBER_PAGES.has(p.tab) ? p.tab : "member";
  }
  if (p.section === "run") return p.tab ? `run/${p.tab}` : "run";
  return tabOf(path);
}
