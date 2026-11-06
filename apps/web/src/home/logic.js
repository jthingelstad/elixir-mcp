import { tagPath } from "../lib/tag-url.js";
import { SETTINGS } from "../lib/settings.js";

/** What Home works out on its own, away from the drawing. */

const HOME = "/home";
export const HOME_TABS = [
  { key: "today", label: "Today", href: HOME },
  { key: "timeline", label: "Timeline", href: `${HOME}/timeline` },
  { key: "friends", label: "Friends", href: `${HOME}/friends` },
];

export const LEADS = new Set(["leader", "coLeader"]);

const MODE_WORDS = {
  ladder: "Trophy Road",
  ranked: "Path of Legends",
  war: "War",
  casual: "Casual",
  event: "Events",
};
export const modeWord = (mode) =>
  MODE_WORDS[mode] ?? `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;

/** Your week's chips: Casual always (Q6), Events only with battles in it
 *  (A34), and the names the game uses: Trophy Road and Path of Legends. */
export function weekChips(modes = {}) {
  const keys = ["ladder", "ranked", "war", "casual"];
  if ((modes.event?.battles ?? 0) > 0) keys.push("event");
  return keys.map((key) => ({ key, label: modeWord(key) }));
}

const clanToday = (tag) => `/clan/${tagPath(tag)}/today`;
const clanActions = (tag) => `/clan/${tagPath(tag)}/actions`;

/** One open Action as a row, in the words its kind is drawn with. A kind with
 *  no drawing keeps Clan's own label. */
function actionRow(need, clan, { when }) {
  const list = clanActions(clan.clan_tag);
  const to =
    need.number != null ? `${list}/${need.number}` : clanToday(clan.clan_tag);
  const who = need.subject_name;
  const key = `action-${need.type}-${need.number ?? who ?? ""}`;
  const named = (title) => (who ? `${title} ${who}` : title);
  switch (need.type) {
    case "away":
      return {
        key,
        title: "Going to be away?",
        detail: [
          need.days_idle != null
            ? `${Math.floor(need.days_idle)} days since your last recorded battle.`
            : null,
          need.away_max_days != null
            ? `Mark yourself away, for up to ${need.away_max_days} days.`
            : "Mark yourself away.",
          "Keeps you off the removal list while it's on. The days keep counting. Modes the battle log doesn't carry aren't seen.",
        ]
          .filter(Boolean)
          .join(" "),
        cta: "Mark me away",
        to: "/clan/you/away",
      };
    case "welcome":
      return {
        key,
        title: named("Welcome a newcomer:"),
        detail: `${need.joined_at ? `Joined ${when(need.joined_at)}. ` : ""}Welcome them in clan chat, then mark it done.`,
        cta: "Open",
        to,
      };
    case "departure":
      return {
        key,
        title: named("Departure: kicked, left, or ignore?"),
        detail: `${need.left_at ? `Departed ${when(need.left_at)}. ` : ""}A leave and a kick look the same on the roster, so confirm which and the clan's history will say so.`,
        cta: "Open",
        to,
      };
    case "removal":
      return {
        key,
        title: named("Remove from the clan:"),
        detail: `${need.headline ? `${need.headline} ` : ""}Modes the battle log doesn't carry aren't seen, so you weigh it.`,
        cta: "Open",
        to,
      };
    default:
      return {
        key,
        title: who ? `${need.label}: ${who}` : need.label,
        detail: need.headline ?? null,
        cta: "Open",
        to,
      };
  }
}

/**
 * "Needs you": the top two of Clan's own order, the count of the rest, then
 * the kinds with a source of their own. Empty when nothing does, and the
 * panel is not drawn.
 */
export function needsYou({ clan, signals, clock }) {
  const rows = [];
  let more = null;
  if (clan?.ok && clan.state === "member") {
    for (const need of clan.needs ?? [])
      rows.push(actionRow(need, clan, clock));
    const rest = (clan.needs_total ?? 0) - (clan.needs?.length ?? 0);
    if (rest > 0)
      more = {
        title: `and ${rest} more in Clan › Today`,
        to: clanToday(clan.clan_tag),
      };
    if (
      LEADS.has(clan.role) &&
      !clan.policy_set &&
      (clan.members ?? 0) >= (clan.min_members ?? Infinity)
    )
      rows.push({
        key: "policy",
        title: `Set up how ${clan.name ?? "your clan"} works`,
        detail: "Nothing runs in Clan until it has a policy.",
        cta: "Start",
        to: `/clan/${tagPath(clan.clan_tag)}/manage/policy`,
      });
  }
  if ((signals?.refusals_7d ?? 0) > 0)
    rows.push({
      key: "refusals",
      title: "An old key is still trying to connect",
      detail:
        "Something is presenting a credential that no longer works. Nothing was read with it.",
      cta: "See connections",
      to: `${SETTINGS}/connections`,
    });
  return { rows, more };
}

/** Home's status words for a clan's standing, as You here says them. */
export const STANDING = {
  holding: "Holding Elder",
  slipping: "Slipping: demotion building",
  rising: "Rising: promotion building",
  participating: "Participating",
  quiet: "Quiet",
};

/** "Season 137, week 4: 2nd, 84,200 fame". The Colosseum is its own week. */
export function lastRaceLine(race) {
  if (!race) return null;
  const week = race.is_colosseum
    ? "Colosseum"
    : `week ${(race.section_index ?? 0) + 1}`;
  const fame =
    race.fame != null ? `, ${race.fame.toLocaleString("en-US")} fame` : "";
  return `Season ${race.season_id}, ${week}: ${ordinal(race.rank)}${fame}`;
}

function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** A family's line on a friend's card: "Trophy Road 24W-9L · War 5W-3L". */
export function familyLine(families = []) {
  return families
    .map((f) => `${modeWord(f.mode)} ${f.wins}W-${f.losses}L`)
    .join(" · ");
}

/** How a person sees the friends read: two lists and their quiet people,
 *  split the way the page says them. Under thirty days a quiet watch is
 *  "No battle recorded this week"; from thirty it is "Quiet for 30 days or
 *  more". Friends are always named, however long. */
export function friendsView(data) {
  const friends = data?.friends ?? [];
  const watching = data?.watching ?? [];
  const quiet = data?.quiet ?? [];
  const named = (q) => q.name ?? q.tag;
  const noBattle = (list) => list.filter((p) => p.battles === 0);
  const played = (list) => list.filter((p) => p.battles > 0);
  const quietFriends = quiet.filter((q) => q.relationship === "friend");
  const quietWatching = quiet.filter((q) => q.relationship === "watching");
  const long = quietWatching.filter((q) => (q.days ?? 0) >= 30);
  const short = quietWatching.filter((q) => (q.days ?? 0) < 30);
  return {
    friends: played(friends),
    friendsTotal: friends.length + quietFriends.length,
    friendsQuiet: [...noBattle(friends).map(named), ...quietFriends.map(named)],
    watching: played(watching),
    watchingQuiet: [...noBattle(watching).map(named), ...short.map(named)],
    watchingLong: long.map(named),
    nobody:
      played(friends).length + played(watching).length === 0 &&
      friends.length + watching.length + quiet.length > 0,
    empty: friends.length + watching.length + quiet.length === 0,
    everyone: [...friends, ...watching, ...quiet].map(named),
  };
}

/** A list of names as the page says them. */
export const names = (list) => list.join(", ");

/** The timeline's rows under their day, with the "new" line placed under the
 *  last row learned since this visit's place. `openedMs` null: a first visit,
 *  which marks nothing new. */
export function timelineDays(items, { day, openedMs }) {
  const isNew = (it) =>
    openedMs !== null && Date.parse(it.observed_at ?? it.at) > openedMs;
  const lastNew = items.reduce((at, it, i) => (isNew(it) ? i : at), -1);
  const days = [];
  items.forEach((it, i) => {
    const at = shownAt(it);
    const key = day(at);
    if (days.at(-1)?.key !== key) days.push({ key, at, rows: [] });
    days.at(-1).rows.push({ it, isNew: isNew(it), newLine: i === lastNew });
  });
  return days;
}

/** Step 3's line: with no player of your own the clan is one you track, and
 *  saying "your player's clan" would name somebody who is not there. */
export const clanStepLine = (name, hasPlayer) =>
  hasPlayer ? `${name}, your player’s clan.` : `${name}, a clan you track.`;

/** The time to show beside an item: the one the feed is ordered by. */
export const shownAt = (it) => it.sort_at ?? it.at;

const OUTCOME_WORDS = { win: "Win", loss: "Loss", draw: "Draw" };
const opposedBy = (o) => o.name ?? o.clan_name ?? o.player_tag;

/** One recorded game in words: "Win 3-0 against <player>, Trophy Road". What
 *  the record cannot say is left out, or said as unknown; never guessed. */
export function gameLine(b) {
  const opponents = b.opponents ?? [];
  const theirs = opponents[0]?.crowns;
  const outcome = b.outcome
    ? (OUTCOME_WORDS[b.outcome] ?? modeWord(b.outcome))
    : "Outcome unknown";
  const score =
    b.outcome && Number.isFinite(b.crowns) && Number.isFinite(theirs)
      ? ` ${b.crowns}-${theirs}`
      : "";
  const against = opponents.length
    ? ` against ${opponents.map(opposedBy).join(" and ")}`
    : "";
  const mode = b.mode_group ? `, ${modeWord(b.mode_group)}` : "";
  return `${outcome}${score}${against}${mode}`;
}

export const whoOf = (it) =>
  it.subject_name ?? it.subject_tag ?? "Your account";
