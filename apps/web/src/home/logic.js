import { tagPath } from "../lib/tag-url.js";
import { SETTINGS } from "../lib/settings.js";

/** What Home works out on its own, away from the drawing. */

/** Home's chips over its one feed (slice 7, #765). Everyone is every item:
 *  the people you follow, your clan and you. The rest are the groups the
 *  server puts each item in (services/web-api/src/feed.mjs). */
export const FEED_CHIPS = [
  { key: "everyone", label: "Everyone" },
  { key: "friends", label: "Friends" },
  { key: "clan", label: "Clan" },
  { key: "you", label: "You" },
];

/** The items a chip shows, in the feed's own order. */
export const feedShown = (items, show) =>
  show === "everyone" || !FEED_CHIPS.some((c) => c.key === show)
    ? items
    : items.filter((it) => (it.groups ?? []).includes(show));

/** What a sparkline says to somebody who cannot see it: the wins and the
 *  losses, then each battle in order with its crown margin, the same facts
 *  the bars draw. */
export function sparkWords(spark = []) {
  const won = spark.filter((b) => b.r === "w").length;
  const lost = spark.filter((b) => b.r === "l").length;
  const drawn = spark.length - won - lost;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const one = (b) =>
    b.r === "d"
      ? "draw"
      : `${b.r === "w" ? "won" : "lost"}${b.m == null ? "" : ` by ${plural(b.m, "crown", "crowns")}`}`;
  return [
    `${plural(spark.length, "battle", "battles")}: `,
    `${plural(won, "win", "wins")}, ${plural(lost, "loss", "losses")}`,
    drawn > 0 ? `, ${plural(drawn, "draw", "draws")}` : "",
    `. In order: ${spark.map(one).join(", ")}`,
  ].join("");
}

export const LEADS = new Set(["leader", "coLeader"]);

/** A panel's answer from its own request: what it said, or that it could not
 *  be read, in one shape whichever of the two failed. Undefined while it is
 *  first reading. An answer in hand outlives a refetch that fails. */
export const panelOf = (query, key) =>
  query.data?.[key] ?? (query.isError ? { ok: false } : undefined);

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

// Clan as one view (slice 8): the leaders' open Actions are Run's Waiting;
// a member sent there lands on the Feed. One Action keeps its number.
const clanWaiting = (tag) => `/clan/${tagPath(tag)}/run/actions`;
const clanActions = (tag) => `/clan/${tagPath(tag)}/actions`;

/** One open Action as a row, in the words its kind is drawn with. A kind with
 *  no drawing keeps Clan's own label. */
function actionRow(need, clan, { when }) {
  const list = clanActions(clan.clan_tag);
  const to =
    need.number != null ? `${list}/${need.number}` : clanWaiting(clan.clan_tag);
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
        detail: `${need.left_at ? `Departed ${when(need.left_at)}. ` : ""}${
          need.suggested_classification === "kick"
            ? `Elixir recommended removing them${Number.isInteger(need.removal_number) ? ` in Action #${need.removal_number}` : ""}. Confirm Kicked or Left.`
            : "A leave and a kick look the same on the roster, so confirm which and the clan's history will say so."
        }`,
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

/** Who says what needs you: the panel's own read, or the card's, which carries
 *  the same answer, when that read has failed or not answered yet. */
export const actionsFrom = ({ clan, needs }) => (needs?.ok ? needs : clan);

/**
 * "Needs you": the top two of Clan's own order, the count of the rest, then
 * the kinds with a source of their own. Empty when nothing does, and the
 * panel is not drawn.
 */
export function needsYou({ clan, needs, signals, clock }) {
  const rows = [];
  let more = null;
  const actions = actionsFrom({ clan, needs });
  if (actions?.ok && actions.state === "member") {
    for (const need of actions.needs ?? [])
      rows.push(actionRow(need, actions, clock));
    const rest = (actions.needs_total ?? 0) - (actions.needs?.length ?? 0);
    if (rest > 0)
      more = {
        title: `and ${rest} more waiting in Clan`,
        to: clanWaiting(actions.clan_tag),
      };
  }
  // Only the card's read knows the clan's size, so this row comes with it.
  if (
    clan?.ok &&
    clan.state === "member" &&
    LEADS.has(clan.role) &&
    !clan.policy_set &&
    (clan.members ?? 0) >= (clan.min_members ?? Infinity)
  )
    rows.push({
      key: "policy",
      title: `Set up how ${clan.name ?? "your clan"} works`,
      detail: "Nothing runs in Clan until it has a policy.",
      cta: "Start",
      to: `/clan/${tagPath(clan.clan_tag)}/run/about`,
    });
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
