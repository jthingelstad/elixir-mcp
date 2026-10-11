/**
 * The clan's activity channel as an editor (Jamie, 2026-10-11: "neither
 * of them would simply be a syndication of the message ... it can either
 * use AI or it can use some code to figure out a better way to frame up
 * what's happening"). The channel tells stories, not timeline lines,
 * whether the clan's model writes them or Elixir does.
 *
 * A story is what one post tells:
 *  - one member's one battle: the arena it moved them into, the band it
 *    crossed, the league it promoted them to, all one post;
 *  - same-kind milestones across members that arrive together (two
 *    badges, three new bests), one post naming each of them;
 *  - a sitting, one story that grows;
 *  - anything else, its own item.
 *
 * Some are skipped by rule, each with its reason in the channel's
 * delivery history: a badge or mastery level-up below its top level, a
 * story that was told and only grew (a sitting's battles, with the same
 * best win and the same run), and an item already told (the same
 * member's same battle, or the same arena, league or band reached again
 * within the week).
 *
 * A story is held until it has been quiet `STORY_HOLD_QUIET_MS`, or for
 * `STORY_HOLD_MAX_MS` since its first item, so the items one moment
 * produces arrive as one post (the sync's queue does the waiting).
 *
 * `renderStory` is Elixir's own words for a story (code mode, the
 * default, and what any refused model post falls back to): deterministic
 * prose from the items' facts and the record context the sync read, no
 * clock time and no link. Pure: items, told rows and context in.
 */

import { badgeLabel } from "@elixir-mcp/record/badge-names";
import { activityCategory } from "./activity.mjs";

/** A story is posted once its newest item is this old... */
export const STORY_HOLD_QUIET_MS = 4 * 60_000;
/** ...or its first item this old, however much it keeps growing. */
export const STORY_HOLD_MAX_MS = 10 * 60_000;
/** Same-kind milestones told in one post, at most. */
export const STORY_GROUP_MAX = 5;
/** The same member reaching the same arena, league or band again within
 *  this long is already told. */
export const STORY_RETOLD_MS = 7 * 24 * 3600_000;
/** Elixir's own post for a story is at most this long. */
export const STORY_TEXT_MAX = 600;
/** A story older than this says when, in words. */
const STORY_LATE_MS = 3 * 3600_000;

/** Why a story was not posted, as the delivery history says it. */
export const STORY_SKIPS = {
  badge_level: "A badge level-up below its top level.",
  only_grew:
    "Told already; it only grew (more battles, the same best win and run).",
  already_told:
    "Told already: the same battle, or the same milestone reached again this week.",
};

/** Kinds told one at a time: each is its own story. */
const ALONE = new Set([
  "session_standout",
  "legendary_badge_earned",
  "member_joined",
  "member_left",
  "member_role_changed",
  "departure_classified",
  "bracket_observed",
  "race_finished",
  "week_resolved",
]);

const playerOf = (it) => it?.facts?.player_tag ?? null;

/** The battle an item names (a promotion, a crossing), if any. */
export const storyBattleId = (it) =>
  it?.facts?.promoted_by?.battle_id ?? it?.facts?.crossed_by?.battle_id ?? null;

/** The battle's facts an item carries. */
const battleOf = (it) =>
  it?.facts?.promoted_by ?? it?.facts?.crossed_by ?? null;

/** What an item reached, for "already told": an arena, a league, a band,
 *  a step, a badge's level. Null when reaching it twice is news. */
export function storyValue(it) {
  const f = it?.facts ?? {};
  switch (it?.kind) {
    case "arena_changed":
      return f.to == null ? null : `arena:${f.to}`;
    case "ranked_promotion":
      return f.to == null ? null : `league:${f.to}`;
    case "best_trophies_band":
      return f.band == null ? null : `band:${f.band}`;
    case "career_wins_step":
      return f.step == null ? null : `wins:${f.step}`;
    case "collection_level_step":
      return f.level == null ? null : `level:${f.level}`;
    case "badge_earned":
      return `badge:${f.badge ?? f.name ?? ""}:${f.level ?? ""}`;
    default:
      return null;
  }
}

/** A badge level-up below its top level: the timeline surfaces every
 *  fifth level, but only the top one is news for the channel. A one-off
 *  badge (no level) and the top level are told. */
export function skippedByRule(it) {
  if (it?.kind !== "badge_earned") return null;
  const f = it.facts ?? {};
  if (typeof f.level !== "number" || f.level <= 1) return null;
  if (typeof f.max_level === "number" && f.level >= f.max_level) return null;
  return "badge_level";
}

/** The run of wins a sitting's digest counts in: a run that grows by
 *  five is news, one more win is not. */
const RUN_STEP = 5;

/**
 * What a story's post says, as its notable facts: a story whose digest
 * did not change since it was told only grew. A sitting is its best win
 * and its run (in steps of five); anything else is its items' revisions,
 * so a late proof (the battle behind an arena move) edits the post.
 */
export function storyDigest(story) {
  const items = story?.items ?? [];
  if (items.length === 1 && items[0].kind === "session_standout") {
    const f = items[0].facts ?? {};
    const run = Math.floor((Number(f.won_in_a_row) || 0) / RUN_STEP);
    return `sitting:${f.best_win?.battle_id ?? "-"}:${run}`;
  }
  return items
    .map((it) => `${it.id}@${it.revision ?? 1}`)
    .sort()
    .join(",");
}

/**
 * The run's items as stories, and what is skipped.
 *
 * @param {object[]} items the fresh items (never told at this revision),
 *   oldest first; never a departure's classification (the sync edits the
 *   departure's own post with it).
 * @param {{
 *   told?: Map<string, { story_key?: string|null, digest?: string|null,
 *     skipped?: boolean, skip_reason?: string|null,
 *     story_size?: number }>,  // story_size: items its post told
 *   battlesTold?: Set<string>,   // "player|battle" told, not skipped
 *   valuesTold?: Set<string>,    // "kind|player|value" told this week
 *   group?: boolean,             // same-kind milestones as one story
 * }} memory the channel's told rows
 * @returns {{
 *   stories: { key: string, items: object[], grown: boolean,
 *     digest: string }[],
 *   skips: { item: object, reason: string, story_key: string,
 *     record: boolean, silent?: boolean }[],
 * }}
 *   A skip with `record` goes into the delivery history (once per item
 *   and reason); `silent` ones (an item that grew inside another story's
 *   post, or one skipped before) are only remembered.
 */
export function buildStories(
  items,
  {
    told = new Map(),
    battlesTold = new Set(),
    valuesTold = new Set(),
    group = true,
  } = {},
) {
  const stories = [];
  const skips = [];
  const skip = (item, reason, storyKey = item.id, opts = {}) =>
    skips.push({
      item,
      reason,
      story_key: storyKey,
      record: told.get(item.id)?.skip_reason !== reason && !opts.silent,
      ...(opts.silent ? { silent: true } : {}),
    });
  const byBattle = new Map();
  const fresh = [];
  for (const it of items) {
    const was = told.get(it.id);
    if (was) {
      // Told before at a lower revision: it grew.
      if (was.skipped) {
        skip(it, was.skip_reason ?? "already_told", it.id, { silent: true });
        continue;
      }
      const key = was.story_key ?? it.id;
      if (key !== it.id) {
        // It grew inside another item's post: that post stands.
        skip(it, "only_grew", key, { silent: true });
        continue;
      }
      if ((was.story_size ?? 1) > 1) {
        // The first item of a post that told several: the post stands,
        // since this run does not hold the others to tell it again.
        skip(it, "only_grew", key);
        continue;
      }
      const story = { key, items: [it], grown: true };
      story.digest = storyDigest(story);
      if (was.digest && was.digest === story.digest) {
        skip(it, "only_grew", key);
        continue;
      }
      stories.push(story);
      continue;
    }
    const rule = skippedByRule(it);
    if (rule) {
      skip(it, rule);
      continue;
    }
    const player = playerOf(it);
    const battle = storyBattleId(it);
    const value = storyValue(it);
    if (
      player &&
      ((battle && battlesTold.has(`${player}|${battle}`)) ||
        (value && valuesTold.has(`${it.kind}|${player}|${value}`)))
    ) {
      skip(it, "already_told");
      continue;
    }
    // One member's one battle is one story.
    if (player && battle) {
      const at = `${player}|${battle}`;
      const story = byBattle.get(at);
      if (story) {
        story.items.push(it);
        continue;
      }
      const s = { key: it.id, items: [it], grown: false };
      byBattle.set(at, s);
      fresh.push(s);
      continue;
    }
    fresh.push({ key: it.id, items: [it], grown: false });
  }
  // Same-kind milestones across members, never told, as one story. A
  // battle's story of several items stays its own.
  const runs = new Map();
  for (const s of fresh) {
    const it = s.items[0];
    if (
      group &&
      s.items.length === 1 &&
      activityCategory(it) === "milestones" &&
      !ALONE.has(it.kind)
    ) {
      const run = runs.get(it.kind);
      if (
        run &&
        run.items.length < STORY_GROUP_MAX &&
        !run.items.some((x) => playerOf(x) === playerOf(it))
      ) {
        run.items.push(it);
        continue;
      }
      runs.set(it.kind, s);
    }
    stories.push(s);
  }
  for (const s of stories) s.digest ??= storyDigest(s);
  const firstAt = (s) => s.items[0].at ?? "";
  stories.sort((a, b) => firstAt(a).localeCompare(firstAt(b)));
  return { stories, skips };
}

/** Whether a story is posted now: quiet long enough, or held long
 *  enough. `observedMs` reads when the record learned an item. */
export function storyReady(story, nowMs, observedMs) {
  const times = story.items.map(observedMs).filter(Number.isFinite);
  if (!times.length) return true;
  return (
    nowMs - Math.max(...times) >= STORY_HOLD_QUIET_MS ||
    nowMs - Math.min(...times) >= STORY_HOLD_MAX_MS
  );
}

/* ------------------------------------------------------------------ */
/* Elixir's own words for a story                                      */
/* ------------------------------------------------------------------ */

const num = (n) =>
  typeof n === "number" ? n.toLocaleString("en-US") : String(n ?? "?");
const plural = (n, one, many = `${one}s`) =>
  `${num(n)} ${n === 1 ? one : many}`;
/** "A, B and C". */
export const andList = (xs) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const who = (it) => it?.facts?.name ?? it?.subject_name ?? "A member";
/** An opponent by name; a tag is never said. */
const opponent = (b) => {
  if (b?.opponent) return b.opponent.name ?? "an opponent";
  const named = (b?.opponents ?? []).map((o) => o.name).filter(Boolean);
  return named.length ? andList(named) : "an opponent";
};
const score = (b) => `${b.crowns ?? "?"}-${b.crowns_against ?? "?"}`;
const ordinal = (n) =>
  ({ 2: "second", 3: "third", 4: "fourth", 5: "fifth" })[n] ?? `${n}th`;

/** One item's clause, after the member's name: "moved up to Magic
 *  Academy", "passed 12,000". */
function clause(it) {
  const f = it.facts ?? {};
  switch (it.kind) {
    case "arena_changed":
      return `${f.to != null && f.from != null && f.to < f.from ? "moved to" : "moved up to"} ${f.to_name ?? "a new arena"}`;
    case "ranked_promotion":
      return `was promoted to ${f.to_name ?? "a new league"}`;
    case "best_trophies_band": {
      // As it happened (2026-10-11): the profile's best can be later and
      // higher than the battle that crossed the rung, so the crossing is
      // told and the peak after it is its own sentence (`laterBest`).
      const after = f.crossed_by?.trophies_after;
      if (f.crossed_by && typeof after === "number" && after !== f.best)
        return `passed ${num(f.band)} trophies for the first time`;
      return f.band != null && f.best !== f.band
        ? `set a new best of ${num(f.best)} trophies, passing ${num(f.band)}`
        : `set a new best of ${num(f.best ?? f.band)} trophies`;
    }
    case "career_wins_step":
      return `passed ${num(f.wins ?? f.step)} career wins`;
    case "collection_level_step":
      return `reached collection level ${num(f.level)}`;
    case "card_unlocked":
      return `unlocked ${f.card ?? "a new card"}`;
    case "card_form_unlocked": {
      const form = { evolution: "Evolution", hero: "Hero" }[f.form];
      return `unlocked ${form ? `${form} ${f.card ?? "a card"}` : `a new form of ${f.card ?? "a card"}`}`;
    }
    case "badge_earned": {
      const badge = f.badge_label ?? badgeLabel(f.badge ?? f.name);
      if (typeof f.level === "number" && f.level > 1)
        return typeof f.max_level === "number" && f.level >= f.max_level
          ? `took ${badge} to its top level, ${num(f.level)}`
          : `took ${badge} to level ${num(f.level)}`;
      return `earned ${badge}`;
    }
    case "legendary_badge_earned":
      return `earned ${f.badge_label ?? badgeLabel(f.badge ?? f.name)}`;
    case "award_granted":
      return `took the clan's ${f.award ?? "award"}${f.season_id != null ? ` for season ${f.season_id}` : ""}`;
    default:
      return null;
  }
}

/** A new best above where its battle ended: "They went on to a best of
 *  12,032." A best below it is a stale read, and nothing is said. */
function laterBest(items) {
  const f = items.find((it) => it.kind === "best_trophies_band")?.facts;
  const after = f?.crossed_by?.trophies_after;
  return f && typeof after === "number" && f.best > after
    ? `They went on to a best of ${num(f.best)}`
    : "";
}

/** A deck's season record, said: "their Hog Rider cycle deck is 9-2 on
 *  ladder this season". */
function deckWords(deck) {
  if (!deck?.label || !(deck.won + deck.lost > 0)) return "";
  const where = { ladder: "on ladder", ranked: "in Ranked" }[deck.mode] ?? null;
  if (!where) return "";
  const rec = `${deck.won}-${deck.lost}${deck.drawn ? `-${deck.drawn}` : ""}`;
  return `their ${deck.label} deck is ${rec} ${where} this season`;
}

/** One member's battle: what it did, the win, and what the record adds. */
function battleStory(items, ctx) {
  const first = items[0];
  const b = battleOf(items.find(battleOf) ?? first);
  const clauses = items.map(clause).filter(Boolean);
  if (!clauses.length) return null;
  let text = `${who(first)} ${clauses[0]}`;
  if (b && b.crowns != null)
    text += ` with a ${score(b)} win over ${opponent(b)}`;
  if (clauses.length > 1) text += ` and ${andList(clauses.slice(1))}`;
  const arena = items.find((it) => it.kind === "arena_changed");
  const mates = ctx.mates ?? [];
  if (arena && mates.length)
    text += `, joining ${mates.length > 3 ? `${plural(mates.length, "clanmate")}` : andList(mates)} there`;
  text += ".";
  const extra = [];
  const peak = laterBest(items);
  if (peak) extra.push(peak);
  if (ctx.promotions >= 2)
    extra.push(`It's their ${ordinal(ctx.promotions)} promotion in a day`);
  const deck = deckWords(ctx.deck);
  if (deck) extra.push(deck.charAt(0).toUpperCase() + deck.slice(1));
  return [text, ...extra.map((e) => `${e}.`)].join(" ");
}

/** A sitting: the record, the modes, the run, the best win, the deck. */
function sittingStory(it) {
  const f = it.facts ?? {};
  const rec = `${f.won ?? 0}-${f.lost ?? 0}${f.drawn ? `-${f.drawn}` : ""}`;
  const decks = (f.decks ?? []).map((d) => d.label).filter(Boolean);
  const modes = Object.entries(f.by_mode ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${n} ${m}`);
  const partner = f.teammate?.name;
  let text = `${who(it)} went ${rec} over ${plural(f.battles ?? 0, "battle")} in one sitting`;
  if (partner)
    text +=
      f.teammate.battles >= f.battles
        ? ` with ${partner} in 2v2`
        : `, ${num(f.teammate.battles)} of them with ${partner} in 2v2`;
  if (decks.length) text += ` playing ${andList(decks.slice(0, 2))}`;
  if (modes.length > 1) text += ` (${modes.join(", ")})`;
  if (typeof f.trophy_net === "number" && f.trophy_net > 0)
    text += `, +${num(f.trophy_net)} trophies`;
  if (f.won_in_a_row >= 3) text += `, winning ${num(f.won_in_a_row)} in a row`;
  text += ".";
  if (f.best_win && f.best_win.crowns != null)
    text += ` The best was a ${score(f.best_win)} win over ${opponent(f.best_win)}.`;
  return text;
}

/** The roster: who joined, departed, changed role. `member` is what the
 *  record says about them (story-facts: tenure, earlier stints). */
function rosterStory(it, member) {
  const f = it.facts ?? {};
  const name = f.name ?? "A member";
  // A tenure the record can stand behind: not a baseline member's
  // (their join is when tracking began, not when they joined).
  const days =
    member && !member.baseline && Number.isInteger(member.tenure_days)
      ? member.tenure_days
      : null;
  const after = days != null && days > 0 ? ` after ${plural(days, "day")}` : "";
  switch (it.kind) {
    case "member_joined": {
      const role = f.role && f.role !== "member" ? ` as ${f.role}` : "";
      const back =
        member?.stints_before > 0
          ? `, back for a ${ordinal(member.stints_before + 1)} stint`
          : "";
      return `${name} joined the clan${role}${back}.`;
    }
    case "member_left": {
      const role =
        f.role_at_departure && f.role_at_departure !== "member"
          ? `, ${/^[aeiou]/i.test(f.role_at_departure) ? "an" : "a"} ${f.role_at_departure},`
          : "";
      return `${name}${role} departed the clan${after}.`;
    }
    case "departure_classified":
      return f.kind === "kick"
        ? `${name} was removed from the clan${after}.`
        : `${name} left the clan on their own${after}.`;
    case "member_role_changed": {
      const rank = { member: 0, elder: 1, coLeader: 2, leader: 3 };
      const say = (r) => (r === "coLeader" ? "co-leader" : r);
      const up =
        f.direction === "promoted" ||
        (!f.direction &&
          (rank[f.role_after] ?? 0) > (rank[f.role_before] ?? 0));
      return up
        ? `${name} was promoted to ${say(f.role_after)}.`
        : `${name} is now ${/^[aeiou]/i.test(say(f.role_after) ?? "") ? "an" : "a"} ${say(f.role_after)} (was ${say(f.role_before)}).`;
    }
    default:
      return null;
  }
}

/** The clan's war week. Points, never a member's share of fame. */
function warStory(it) {
  const f = it.facts ?? {};
  const week = (f.section_index ?? 0) + 1;
  switch (it.kind) {
    case "bracket_observed": {
      const rivals = (f.rivals ?? []).map((r) => r.name).filter(Boolean);
      return rivals.length
        ? `War week ${week}${f.is_colosseum ? " (Colosseum)" : ""}: up against ${andList(rivals)}.`
        : null;
    }
    case "race_finished":
      return `The boat crossed the finish line${f.fame != null ? ` with ${num(f.fame)} fame` : ""}.`;
    case "week_resolved": {
      const top = (f.members ?? [])
        .filter((m) => typeof m.points === "number" && m.points > 0 && m.name)
        .slice(0, 3)
        .map(
          (m) =>
            `${m.name} (${num(m.points)} points${typeof m.decks_used === "number" ? `, ${plural(m.decks_used, "deck")}` : ""})`,
        );
      const war =
        typeof f.trophy_change === "number" && f.trophy_change !== 0
          ? ` (${f.trophy_change > 0 ? "+" : ""}${num(f.trophy_change)} war trophies)`
          : "";
      return `War week ${week} finished${f.rank ? ` in place ${f.rank}` : ""}${f.fame != null ? ` with ${num(f.fame)} fame` : ""}${war}${top.length ? `, led by ${andList(top)}` : ""}.`;
    }
    default:
      return null;
  }
}

/** When, in words, for a story told late; nothing within three hours. */
export function whenWords(atMs, nowMs) {
  const age = nowMs - atMs;
  if (!Number.isFinite(age) || age < STORY_LATE_MS) return "";
  if (age < 12 * 3600_000) return "Earlier today";
  if (age < 36 * 3600_000) return "Yesterday";
  return `${Math.round(age / (24 * 3600_000))} days ago`;
}

/** A post never starts as Discord markdown (a heading, a list, a quote):
 *  a name like "# King" stays a name. Applied after escaping. */
export const leadSafe = (s) => (/^(?:#|-|\+|\d+\.)/.test(s) ? `\\${s}` : s);

/**
 * Elixir's own post for a story: one or two sentences, no clock time
 * (a story told over three hours late says when in words), no link.
 * `ctx`: what the sync read for it (`deck`, `promotions`, `mates`) and
 * the members' records (`members`, story-facts), and `nowMs`.
 * Returns plain text; the sync escapes it for Discord.
 */
export function renderStory(story, ctx = {}) {
  const items = story.items ?? [];
  const first = items[0];
  if (!first) return "";
  let text = null;
  if (first.kind === "session_standout") text = sittingStory(first);
  else if (activityCategory(first) === "members")
    text = rosterStory(first, ctx.members?.[playerOf(first)]);
  else if (activityCategory(first) === "war") text = warStory(first);
  else if (items.some(battleOf) && new Set(items.map(playerOf)).size === 1)
    text = battleStory(items, ctx);
  else if (items.length > 1) {
    // Same-kind milestones across members: one sentence naming each,
    // and the members together when they did the same thing.
    const told = items
      .map((it) => ({ name: who(it), c: clause(it) }))
      .filter((x) => x.c);
    const same = told.every((x) => x.c === told[0]?.c);
    text = !told.length
      ? null
      : same
        ? `${andList(told.map((x) => x.name))} ${told[0].c.replace(/^was /, "were ")}.`
        : `${andList(told.map((x) => `${x.name} ${x.c}`))}.`;
  } else {
    const c = clause(first);
    text = c ? `${who(first)} ${c}.` : null;
  }
  // Nothing the editor knows how to tell: the timeline's own sentence.
  text ??= String(first.text ?? "").trim();
  const lastAt = Math.max(
    ...items.map((it) =>
      Date.parse(
        it.kind === "session_standout"
          ? (it.facts?.ended_at ?? it.at)
          : (it.at ?? ""),
      ),
    ),
  );
  const when = whenWords(lastAt, ctx.nowMs ?? Date.now());
  const out = when ? `${when}: ${text}` : text;
  return out.length > STORY_TEXT_MAX
    ? `${out.slice(0, STORY_TEXT_MAX - 1)}…`
    : out;
}
