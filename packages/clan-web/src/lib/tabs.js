/**
 * Clan as one view (slice 8, #766): Feed, Standings, War, Members, Policy
 * and, for the leader and co-leaders, Run. They replaced the five tabs of
 * redesign step 4 (Today, Members, Season, Awards, Run) on 2026-11-12. This
 * is only what goes on them and which one a path is on.
 *
 * Who sees what:
 * - Feed, Standings, War, Members and Policy are every member's, at any
 *   size, with or without a policy. Each page says what waits on a policy.
 * - Run is for a verified leader or co-leader, with or without a policy; the
 *   server refuses its reads to anyone else (`GET /api/clans/<tag>/run`).
 * - Members has no row of its own since G6 (2026-11-12): the roster with a
 *   Follow on each row, the Map for verified members while the clan keeps it
 *   on, Spread the word with Recruit's pitch for every member (A11), and
 *   Scout at its foot for elders and up. Standing is on Standings for every
 *   member; Review is in Run, the leaders'. Who sees what did not change.
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

/** The tabs' keys, in order, the leaders' Run last. */
export const TAB_KEYS = [
  "feed",
  "standings",
  "war",
  "members",
  "policy",
  "run",
];

/** The tabs, in order, for the selected clan. Feed's count is attention: the
 *  actions waiting for you, which the feed shows first. */
export function clanTabs(me) {
  const clan = me?.selected ?? null;
  if (!clan) return [];
  const base = clanPath(clan.clan_tag);
  const waiting = waitingFor(me);
  const tabs = [
    {
      key: "feed",
      label: "Feed",
      href: `${base}/feed`,
      count: waiting || null,
      countLabel: "waiting for you",
    },
    { key: "standings", label: "Standings", href: `${base}/standings` },
    { key: "war", label: "War", href: `${base}/war` },
    { key: "members", label: "Members", href: `${base}/members` },
    { key: "policy", label: "Policy", href: `${base}/policy` },
  ];
  if (leads(clan)) tabs.push({ key: "run", label: "Run", href: `${base}/run` });
  return tabs;
}

/** `/clan/<TAG>/<section>[/<tab>]` as its parts, or null. */
function parts(path) {
  const m = /^\/([^/]+)(?:\/([a-z]+)(?:\/([a-z0-9-]+))?)?\/?$/i.exec(
    appPath(path) ?? "",
  );
  if (!m || !tagOf(m[1])) return null;
  return { section: m[2] ?? null, tab: m[3] ?? null };
}

/** Which tab a path is on. An action's own page is under Feed, where it
 *  waits. */
export function tabOf(path) {
  const p = parts(path);
  if (!p) return null;
  if (p.section === "actions") return "feed";
  return TAB_KEYS.includes(p.section) ? p.section : null;
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
  if (p.section === "actions") return p.tab ? "action" : "feed";
  if (p.section === "members") {
    if (!p.tab) return "roster";
    return MEMBER_PAGES.has(p.tab) ? p.tab : "member";
  }
  if (p.section === "run") return p.tab ? `run/${p.tab}` : "run";
  return tabOf(path);
}
