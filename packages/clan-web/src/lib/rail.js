/**
 * What the rail offers depends on who is looking and on the clan's policy:
 * until a leader saves one, and while the clan has fewer than 10 members,
 * only the roster, Recruit, Scout, the policy editor and clan settings
 * exist (nothing in clan management runs). Manage for leaders and
 * co-leaders, Awards for all members, Scout also for elders, Away when the policy lets
 * members mark it, Maintain for the product's maintainer. Two items the
 * reader can see at once never share a label.
 * The rail itself is Elixir's (the kit's Rail); this is only what goes
 * on it and which item a path is on.
 */
import { CLAN, appPath, clanPath, tagOf } from "./base.js";

const LEADERS = new Set(["leader", "coLeader"]);
const ELDER_PLUS = new Set(["leader", "coLeader", "elder"]);

export function railItems(me) {
  const clan = me?.selected ?? null;
  const base = clan ? clanPath(clan.clan_tag) : null;
  const items = [];
  if (me?.ok && me.clans?.length > 1)
    items.push({
      key: "clans",
      label: "Clans",
      icon: "layers",
      to: `${CLAN}/clans`,
    });
  const policy = me?.policy ?? null;
  // Active: a saved policy on a clan of at least 10 (an older /api/me
  // without the flag reads as its `set`).
  const set = policy?.active ?? policy?.set === true;
  if (clan) {
    items.push({ key: "clan", label: "Clan", icon: "users", to: base });
    // "You here": your own numbers in this clan, with or without a policy.
    items.push({
      key: "me",
      label: "You here",
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
    // Actions: what waits for you, as who you are in this clan.
    if (set)
      items.push({
        key: "actions",
        label: "Actions",
        icon: "inbox",
        to: `${base}/actions`,
        meta: me.open_actions ? String(me.open_actions) : undefined,
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
    if (social)
      items.push({
        group: "Social",
        key: "map",
        label: "Map",
        icon: "map",
        to: `${base}/map`,
      });
    items.push({
      ...(social ? {} : { group: "Social" }),
      key: "recruit",
      label: "Recruit",
      icon: "megaphone",
      to: `${base}/recruit`,
    });
    const leader = LEADERS.has(clan.role);
    const elder = ELDER_PLUS.has(clan.role);
    if (leader) {
      if (set) {
        items.push({
          group: "Manage",
          key: "board",
          label: "Board",
          icon: "layout-dashboard",
          to: `${base}/manage/board`,
        });
        items.push({
          key: "history",
          label: "History",
          icon: "history",
          to: `${base}/manage/history`,
        });
      }
      items.push({
        ...(set ? {} : { group: "Manage" }),
        key: "policy",
        label: "Policy",
        icon: "file-text",
        to: `${base}/manage/policy`,
      });
      // Clan settings: what belongs to the whole clan (the clan's own
      // model first). Any clan, with or without a policy, like Recruit.
      items.push({
        key: "settings",
        label: "Settings",
        icon: "settings",
        to: `${base}/manage/settings`,
      });
    }
    if (elder) {
      items.push({
        ...(leader || set ? {} : { group: "Manage" }),
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
      key: "away",
      label: "Away",
      icon: "plane",
      to: `${CLAN}/you/away`,
    });
  items.push({
    key: "feedback",
    label: "Feedback",
    icon: "message-square",
    to: `${CLAN}/feedback`,
    dot: me?.feedback_unseen
      ? {
          tone: "unread",
          title: `${me.feedback_unseen} new repl${me.feedback_unseen === 1 ? "y" : "ies"}`,
        }
      : null,
  });
  if (me?.maintainer)
    items.push({
      group: "Maintain",
      key: "maintain",
      label: "Feedback queue",
      icon: "inbox",
      to: `${CLAN}/maintain/feedback`,
    });
  return items;
}

/** Which rail item a path is on: read under the prefix, where the app's
 *  own pages come before a clan's tag. */
export function railKey(path) {
  const app = appPath(path) ?? "";
  if (/^\/[^/]+\/members\/[a-z0-9]+$/i.test(app)) return "clan";
  if (app === "/clans") return "clans";
  if (app === "/you") return "you";
  if (app.startsWith("/you/away")) return "away";
  if (app.startsWith("/feedback")) return "feedback";
  if (app.startsWith("/maintain")) return "maintain";
  const m =
    /^\/([^/]+)(?:\/(me|week|actions|standing|trophies|awards|recruit|map|manage)(?:\/([a-z0-9-]+))?)?\/?$/.exec(
      app,
    );
  if (!m || !tagOf(m[1])) return null;
  const [, , section, tab] = m;
  if (!section) return "clan";
  if (
    [
      "me",
      "week",
      "actions",
      "standing",
      "trophies",
      "awards",
      "recruit",
      "map",
    ].includes(section)
  )
    return section;
  if (tab === "model") return "settings";
  return !tab || tab === "inbox" ? "actions" : tab;
}
