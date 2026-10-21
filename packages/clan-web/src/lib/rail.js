/**
 * What the rail offers depends on who is looking and on the clan's policy:
 * until a leader saves one, and while the clan has fewer than 10 members,
 * only the roster, Recruit, Scout, the policy editor and clan settings
 * exist (nothing in clan management runs). Manage and Social's Discord
 * for leaders and co-leaders, Awards for all members, Scout also for elders, Away when the policy lets
 * members mark it. Feedback is the rail's foot, Elixir's one system
 * (2026-10-08), not an item. Two items the
 * reader can see at once never share a label.
 * The rail itself is Elixir's (the kit's Rail); this is only what goes
 * on it and which item a path is on.
 */
import { CLAN, appPath, clanPath, tagOf } from "./base.js";

const LEADERS = new Set(["leader", "coLeader"]);
const ELDER_PLUS = new Set(["leader", "coLeader", "elder"]);

/** Whether the selected clan's policy is active: saved, on a clan of at
 *  least 10 (an older /api/me without the flag reads as its `set`). */
const policyActive = (me) => me?.policy?.active ?? me?.policy?.set === true;

/** The Actions waiting for this person in the selected clan, as who they
 *  are there; none while the policy is not active. */
export const waitingFor = (me) =>
  policyActive(me) ? Number(me.open_actions ?? 0) : 0;

export function railItems(me) {
  const clan = me?.selected ?? null;
  const base = clan ? clanPath(clan.clan_tag) : null;
  // Your clans are the rail's head, the Clan picker (Jamie, 2026-10-20),
  // never an item: the list is the clan's sections.
  const items = [];
  const policy = me?.policy ?? null;
  const set = policyActive(me);
  if (clan) {
    // The roster's own address: the clan's bare one is the landing,
    // which is Actions for a leader with Actions waiting (2026-10-20).
    items.push({
      key: "clan",
      label: "Roster",
      icon: "users",
      to: `${base}/roster`,
    });
    // "You here": your own numbers in this clan, with or without a policy.
    items.push({
      key: "me",
      label: "Your clan record",
      icon: "activity",
      to: `${base}/me`,
    });
    // The week in the clan: every member's, with or without a policy.
    items.push({
      key: "week",
      label: "The week",
      icon: "book-open",
      to: `${base}/week`,
    });
    items.push({
      key: "season",
      label: "Season",
      icon: "calendar-days",
      to: `${base}/season`,
    });
    // Actions: what waits for you, as who you are in this clan. The
    // count is attention, not a total: folded on a phone, the rail's
    // row marks it (the kit's Rail, `attention`).
    const waiting = waitingFor(me);
    if (set)
      items.push({
        key: "actions",
        label: "Actions",
        icon: "inbox",
        to: `${base}/actions`,
        meta: waiting ? String(waiting) : undefined,
        attention: waiting ? `${waiting} waiting for you` : undefined,
      });
    if (set)
      items.push({
        key: "standing",
        label: "Standing",
        icon: "chart-column",
        to: `${base}/standing`,
      });
    if (set)
      items.push({
        key: "trophies",
        label: "Award history",
        icon: "history",
        to: `${base}/trophies`,
      });
    if (set)
      items.push({
        key: "awards",
        label: "Award races",
        icon: "award",
        to: `${base}/awards`,
      });
    // Social (Jamie, 2026-09-26): the clan's own section, in every clan at
    // any size, with or without a policy. The map is the members' own
    // sharing, which a leader can turn off; Recruit stays either way. It
    // is for verified members: an unverified player does not see it.
    const social = me?.social?.enabled !== false && clan.verified !== false;
    // Every item names its group, and the kit draws a heading where the
    // group changes: an item's heading never depends on which items the
    // reader's role and the policy happen to put before it (an elder in
    // a clan with a policy once found Scout under Social).
    if (social)
      items.push({
        group: "Social",
        key: "map",
        label: "Map",
        icon: "map",
        to: `${base}/map`,
      });
    items.push({
      group: "Social",
      key: "recruit",
      label: "Recruit",
      icon: "megaphone",
      to: `${base}/recruit`,
    });
    const leader = LEADERS.has(clan.role);
    // Discord (Jamie, 2026-10-10): the clan's activity in a channel of
    // its own, for the leader and co-leaders, with or without a policy
    // (without one it posts nothing, and the page says so).
    if (leader)
      items.push({
        group: "Social",
        key: "discord",
        label: "Discord",
        icon: "message-square",
        to: `${base}/discord`,
      });
    const elder = ELDER_PLUS.has(clan.role);
    if (leader) {
      if (set) {
        items.push({
          group: "Manage",
          key: "board",
          label: "Member review",
          icon: "layout-dashboard",
          to: `${base}/manage/board`,
        });
        items.push({
          group: "Manage",
          key: "history",
          label: "Decisions",
          icon: "history",
          to: `${base}/manage/history`,
        });
      }
      items.push({
        group: "Manage",
        key: "policy",
        label: "Policy",
        icon: "file-text",
        to: `${base}/manage/policy`,
      });
      // Clan settings: what belongs to the whole clan (the clan's own
      // model first). Any clan, with or without a policy, like Recruit.
      items.push({
        group: "Manage",
        key: "settings",
        label: "Settings",
        icon: "settings",
        to: `${base}/manage/settings`,
      });
    }
    if (elder) {
      items.push({
        group: "Manage",
        key: "scout",
        label: "Scout",
        icon: "search",
        to: `${base}/manage/scout`,
      });
    }
  }
  items.push({
    group: "You",
    key: "you",
    label: "Players",
    icon: "user-round",
    to: `${CLAN}/you`,
  });
  if (clan && policy?.away)
    items.push({
      group: "You",
      key: "away",
      label: "Away",
      icon: "plane",
      to: `${CLAN}/you/away`,
    });
  return items;
}

/** Which rail item a path is on: read under the prefix, where the app's
 *  own pages come before a clan's tag. */
export function railKey(path) {
  const app = appPath(path) ?? "";
  if (/^\/[^/]+\/members\/[a-z0-9]+$/i.test(app)) return "clan";
  if (/^\/[^/]+\/roster\/?$/i.test(app) && tagOf(app.split("/")[1]))
    return "clan";
  // The chooser has no item; feedback from it names it.
  if (app === "/clans") return "clans";
  if (app === "/you") return "you";
  if (app.startsWith("/you/away")) return "away";
  const m =
    /^\/([^/]+)(?:\/(me|week|season|actions|standing|trophies|awards|recruit|map|discord|manage)(?:\/([a-z0-9-]+))?)?\/?$/.exec(
      app,
    );
  if (!m || !tagOf(m[1])) return null;
  const [, , section, tab] = m;
  if (!section) return "clan";
  if (
    [
      "me",
      "week",
      "season",
      "actions",
      "standing",
      "trophies",
      "awards",
      "recruit",
      "map",
      "discord",
    ].includes(section)
  )
    return section;
  if (tab === "model") return "settings";
  return !tab || tab === "inbox" ? "actions" : tab;
}
