import { tagPath } from "../lib/tag-url.js";
import { SETTINGS } from "../lib/settings.js";

/** What Home works out on its own, away from the drawing. */

/** Home's chips over its one feed (slice 7, #765). Everyone is every item:
 *  the people you follow, your clan and you. The rest are the groups the
 *  server puts each item in (services/web-api/src/feed.mjs). */
export const FEED_CHIPS = [
  { key: "everyone", label: "Everyone" },
  // Close friends (2026-11-16): offered only to an account that has marked
  // one (feedChips); the mark and the chip are the reader's alone.
  { key: "close", label: "Close friends" },
  { key: "friends", label: "Friends" },
  { key: "clan", label: "Clan" },
  { key: "you", label: "You" },
];

/** The Show chips this reader gets: Close friends only once one is marked. */
export const feedChips = (hasClose) =>
  FEED_CHIPS.filter((c) => c.key !== "close" || hasClose);

/** Where the feed's Show choice is kept, per account, in this browser. */
const SHOW_KEY = "elixir.home.show:";

/** The Show chip this reader chose last time here, if it is one we still
 *  offer; storage that is blocked or empty means Everyone. */
export function keptShow(who) {
  if (!who) return "everyone";
  try {
    const v = window.localStorage.getItem(SHOW_KEY + who);
    return FEED_CHIPS.some((c) => c.key === v) ? v : "everyone";
  } catch {
    return "everyone";
  }
}

/** Keep the reader's Show choice for their next visit. Never throws. */
export function keepShow(who, show) {
  if (!who) return;
  try {
    if (show === "everyone") window.localStorage.removeItem(SHOW_KEY + who);
    else window.localStorage.setItem(SHOW_KEY + who, show);
  } catch {
    // Storage blocked: the choice lasts this visit.
  }
}

/** A close friend's week in one short line, as facts: how many battles on
 *  how many days, or that there were none. Never a nudge. */
export function circleLine(f) {
  if (!f || !(f.battles > 0)) return "No battles this week";
  const n = (v, one, many) =>
    `${v.toLocaleString("en-US")} ${v === 1 ? one : many}`;
  const parts = [n(f.battles, "battle", "battles")];
  if (f.days > 0) parts.push(`${n(f.days, "day", "days")}`);
  return parts.join(" · ");
}

/** The circle's fuller line: sittings too, when the week told them. */
export function circleDetail(f) {
  const line = circleLine(f);
  if (!f || !(f.battles > 0) || !(f.sittings > 0)) return line;
  return `${line} · ${f.sittings} ${f.sittings === 1 ? "sitting" : "sittings"}`;
}

/** Why a player is offered for the circle, as facts. */
export function circleWhy(s) {
  const why = [];
  if (s?.follows_you) why.push("Follows you");
  if (s?.clanmate) why.push("Clanmate");
  return why.join(" · ") || "You follow them";
}

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

/** A clan role in words, as the game names it. */
const ROLES = {
  leader: "Leader",
  coLeader: "Co-leader",
  elder: "Elder",
  member: "Member",
};
export const roleLabel = (role) => ROLES[role] ?? null;

/** A panel's answer from its own request: what it said, or that it could not
 *  be read, in one shape whichever of the two failed. Undefined while it is
 *  first reading. An answer in hand outlives a refetch that fails. */
export const panelOf = (query, key) =>
  query.data?.[key] ?? (query.isError ? { ok: false } : undefined);

const MODE_WORDS = {
  ladder: "Trophy Road",
  ranked: "Ranked",
  war: "War",
  casual: "Casual",
  event: "Events",
};
export const modeWord = (mode) =>
  MODE_WORDS[mode] ?? `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;

/** Your week's chips: Casual always (Q6), Events only with battles in it
 *  (A34), and the names the game uses: Trophy Road and Ranked. */
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
        to: `/clan/${tagPath(clan.clan_tag)}/members/away`,
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
        title: `See ${rest} more in Clan`,
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

/** This week's race as facts (`race_now` from Home's clan read): which week
 *  and day, and on a war day the clan's place by fame and its fame. Never
 *  the day's decks, and no "of N". */
export function raceNowLine(race) {
  if (!race) return null;
  const week = race.is_colosseum
    ? "Colosseum"
    : `week ${(race.section_index ?? 0) + 1}`;
  const head = `Season ${race.season_id}, ${week}`;
  if (race.day_kind === "training") return `${head}: training days`;
  if (race.finished) return `${head}: finished`;
  const day = race.war_day != null ? `, war day ${race.war_day}` : "";
  const fame = race.fame ? `${race.fame.toLocaleString("en-US")} fame` : null;
  if (race.place == null)
    return fame ? `${head}${day}: ${fame}` : `${head}${day}`;
  return `${head}${day}: ${ordinal(race.place)} by fame${fame ? `, ${fame}` : ""}`;
}

const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

const many = (n, one, other) => (n === 1 ? one : `${n} ${other}`);

/** When a clanmate last played, as a day: "played today", "played
 *  yesterday", else "last played Monday, November 9". */
function playedLine(at, dayHeading) {
  if (!at || !dayHeading) return null;
  const day = dayHeading(at);
  if (day === "Today" || day === "Yesterday")
    return `played ${day.toLowerCase()}`;
  return `last played ${day}`;
}

/** Why a person is suggested, one fact per reason, in game names: never a
 *  nickname, never a rating. The friendly battles come first: "those are
 *  probably folks they know" (Jamie, 2026-11-13). `dayHeading` is the
 *  clock's (useClock().feedDayHeading), for a clanmate's last battle. */
export function whyLine(why, { dayHeading = null } = {}) {
  if (why.kind === "clan") {
    if (why.recorded) return "In your clan, already in Elixir";
    const played = playedLine(why.last_battle, dayHeading);
    return played ? `In your clan, ${played}` : "In your clan";
  }
  // Near you (#768): never finer than the place its owner picked.
  if (why.kind === "near")
    return why.place_name
      ? `Plays near you, in ${why.place_name}`
      : "Plays near you";
  if (why.kind === "followed_by") {
    const who = why.via?.name ?? why.via?.tag ?? "A player you follow";
    return why.others > 0
      ? `${who} follows them, and ${why.others} more you follow`
      : `${who} follows them`;
  }
  if (why.kind === "battles") {
    const span = why.days === 7 ? "this week" : `in the last ${why.days} days`;
    const friendly = why.friendly ?? 0;
    const clan = why.clanmate_battles ?? 0;
    const rest = Math.max(0, (why.against ?? 0) - friendly - clan);
    const played = [
      friendly ? many(friendly, "a friendly battle", "friendly battles") : null,
      clan ? many(clan, "a clan friendly", "clan friendlies") : null,
    ].filter(Boolean);
    const parts = [];
    if (played.length)
      parts.push(
        `You played ${played.join(" and ")}${rest ? `, and ${times(rest)} more` : ""}`,
      );
    else if (rest) parts.push(`You played them ${times(rest)}`);
    if (why.with_you > 0)
      parts.push(
        `${parts.length ? "your" : "Your"} 2v2 teammate${why.with_you > 1 ? ` ${times(why.with_you)}` : ""}`,
      );
    return parts.length ? `${parts.join(", ")} ${span}` : null;
  }
  return null;
}

/** A person's reasons, joined. */
export const whyLines = (whys, clock) =>
  (whys ?? [])
    .map((w) => whyLine(w, clock))
    .filter(Boolean)
    .join(" · ");

/** A suggested person's cost mark: free, or a slot. Following is its own
 *  word. */
export function costMark(p) {
  // Since 2026-11-13 a row says only when a follow costs nothing; what
  // following the list costs is one line by its button (followPlanLine).
  if (p.following || !p.free) return null;
  return "Free";
}

/** What the Free mark means, for its title. */
export const FREE_HINT =
  "Already recorded, so following uses none of your follows";

/** Find's From your battles: how often you met and how it went, from the
 *  log only. When you last met is its own line (`lastMetLine`). */
export function metLine(p) {
  const parts = [];
  if (p.friendly > 0)
    parts.push(
      p.friendly === 1 ? "A friendly battle" : `${p.friendly} friendly battles`,
    );
  if (p.against > 0) {
    parts.push(`Met ${times(p.against)}`);
    const rec = [
      p.wins ? `${p.wins} win${p.wins === 1 ? "" : "s"}` : null,
      p.losses ? `${p.losses} loss${p.losses === 1 ? "" : "es"}` : null,
      p.draws ? `${p.draws} draw${p.draws === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    if (rec.length) parts.push(rec.join(", "));
  }
  if (p.with_you > 0) parts.push(`Your 2v2 teammate ${times(p.with_you)}`);
  return parts.join(" · ");
}

/** When you last met, in Home's words (2026-11-13): "Last met today,
 *  3:52 pm", "Last met Tuesday, 4:53 am". `feedWhen` is the clock's. */
export function lastMetLine(p, feedWhen) {
  if (!p.last_met) return null;
  const said = feedWhen(p.last_met).replace(
    /^(Today|Tonight|Yesterday)\b/,
    (d) => d.toLowerCase(),
  );
  return `Last met ${said}`;
}

/** The line under Home's people: "12 of your 50 follows used". */
export const slotsLine = (used, limit) =>
  limit == null ? null : `${used} of your ${limit} follows used`;

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
  hasPlayer ? `${name}, your player’s clan.` : `${name}, a clan you follow.`;

/** The time to show beside an item: the one the feed is ordered by. */
export const shownAt = (it) => it.sort_at ?? it.at;

/** The instant the "N new" pill counts from (2026-11-14): the first
 *  page's `watermark`, the server's newest change across the whole stored
 *  week (an item sorting later or learned later; Codex on #1038). Before a
 *  server that sends it, the newest change the first page shows, or the
 *  end of its week. Null before the first page is read. */
export function feedSince(page) {
  if (!page) return null;
  if (page.watermark) return page.watermark;
  let best = null;
  for (const it of page.timeline ?? []) {
    const ms = Math.max(
      Date.parse(shownAt(it)) || 0,
      Date.parse(it.observed_at ?? it.at) || 0,
    );
    if (ms > 0 && (best === null || ms > best)) best = ms;
  }
  if (best === null) {
    const end = Date.parse(page.window?.to ?? "");
    best = Number.isFinite(end) ? end : null;
  }
  return best === null ? null : new Date(best).toISOString();
}

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

/** Home's digest panel's three choices (canvas: Weekly / Daily / Off). */
export const DIGEST_CHOICES = [
  { key: "weekly", label: "Weekly" },
  { key: "daily", label: "Daily" },
  { key: "off", label: "Off" },
];

/** Which choice is lit: the person's own setting, else the default (the
 *  digest is on, weekly, until someone changes it). */
export function digestChoice(digest) {
  if (digest?.enabled === false) return "off";
  return digest?.cadence === "daily" ? "daily" : "weekly";
}

/** When the digest comes, in the panel's words. */
export const digestWhen = (choice) =>
  choice === "daily" ? "daily" : "once a week";

/** The digest step's line once chosen, from the person's own setting. */
export function digestLine(digest) {
  if (!digest) return null;
  if (digest.enabled === false) return "Your digest is off.";
  return digest.cadence === "daily"
    ? "Your digest comes daily."
    : "Your digest comes weekly.";
}

/**
 * The starter set's plan (2026-11-13), from its own read: the ticked people,
 * how many are free and how many take a slot, against the slots left. The
 * shape of a follow plan (followPlanLine, FollowAll), so the one confirmed
 * follow-all says it; the server prices it again when it follows.
 */
export function starterPlan(chosen, used, limit) {
  const slots = chosen.filter((p) => !p.free).length;
  return {
    players: chosen.map((p) => ({ player_tag: p.tag, free: Boolean(p.free) })),
    to_follow: chosen.length,
    free: chosen.length - slots,
    slots,
    following: 0,
    used: used ?? 0,
    limit: limit ?? null,
    fits: limit == null || slots === 0 || (used ?? 0) + slots <= limit,
  };
}

/** Home offers its suggested follows while fewer than this many of the
 *  players an account follows played in the last seven days (its own not
 *  counted, nor clans) [engineering, 2026-11-13; 2026-11-14, #1016]. The
 *  server holds the same number (STARTER_UNDER). */
export const STARTER_UNDER = 5;

/** Whether Home offers the starter set (2026-11-13): on every visit while
 *  fewer than STARTER_UNDER of the players the account follows have a
 *  recorded battle in the last seven days (Jamie: "even if it isn't their
 *  first login"; #1016: ten quiet follows are not a feed), unless "Not now"
 *  was said and its 30 days have not run out. From Home's own read
 *  (`setup.following_played`, or `setup.following` from an older read); the
 *  server checks the same before it answers. */
export function offersStarter(first, nowMs = Date.now()) {
  const setup = first?.setup;
  const played =
    typeof setup?.following_played === "number"
      ? setup.following_played
      : setup?.following;
  if (typeof played !== "number" || played >= STARTER_UNDER) return false;
  const until = first?.starter_hidden_until;
  return !(until && Date.parse(until) > nowMs);
}

/**
 * What a quiet Home says (#1016), from the passport's count of the players
 * you follow by their activity (`owner.profile.follows`: following, active,
 * inactive, unknown; stamps eligibility followActivity), so a quiet feed is
 * friend-focused and honest about coverage:
 *
 *  - nobody followed yet: the feed waits for friends;
 *  - any follow whose battles Elixir has not read lately (unknown), or one
 *    with a recorded battle the stored feed has not caught (active):
 *    Elixir is still catching up, never "they didn't play";
 *  - every follow freshly read with no battle this week: they have been
 *    quiet;
 *  - the counts unread or failed: the plain line, claiming neither.
 */
export function quietFeed(follows) {
  if (!follows || typeof follows.following !== "number")
    return {
      key: "unknown",
      title: "Nothing in the last seven days",
      body: "Battles from the players you follow, your clan and you show up here.",
    };
  if (follows.following === 0)
    return {
      key: "none",
      title: "Your feed is waiting for friends",
      body: "Follow your friends and clanmates, and their battles show up here.",
    };
  if ((follows.unknown ?? 0) > 0 || (follows.active ?? 0) > 0)
    return {
      key: "catching_up",
      title: "Still catching up",
      body: "Elixir is still reading battles for some of the players you follow. Their play shows up here once it’s read.",
    };
  const one = follows.following === 1;
  return {
    key: "quiet",
    title: one
      ? "The player you follow has been quiet"
      : "The players you follow have been quiet",
    body: one
      ? "They haven’t played a battle in the last 7 days. When they do, it shows up here."
      : "None of them has played a battle in the last 7 days. When they do, it shows up here.",
  };
}
