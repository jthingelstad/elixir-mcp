/**
 * The clan's Rules, as leaders set them and members read them (2026-11-23):
 * the policy's fields asked as six plain questions, the checks that read a
 * draft with the engine's own math, and the public part a clan directory
 * tile shows. Pure: every input, the roster's size and Elder count
 * included, is an argument.
 */

import { band } from "./standing.mjs";
import { countedCategories, ranksElder, validate } from "./policy.mjs";

/**
 * The six questions, in the order the editor asks them. `fields` are asked
 * in the open; `more` are folded under the question. Every policy field is
 * in exactly one question, so nothing a leader can set is lost.
 */
export const QUESTIONS = [
  {
    key: "about",
    title: "What is your clan about?",
    fields: ["war_intent", "posture", "goal_together"],
    more: [],
  },
  {
    key: "weekly",
    title: "What should members do each week?",
    fields: [
      "war_enabled",
      "war_min_decks",
      "ranked_enabled",
      "ranked_min_battles",
      "donations_enabled",
      "donations_min_weekly",
      "trophies_enabled",
      "trophies_min",
      "minimums_rule",
      "minimums_window_weeks",
    ],
    more: [],
  },
  {
    key: "elder",
    title: "Who becomes Elder?",
    fields: [
      "elder_mode",
      "elder_weight_war",
      "elder_weight_ranked",
      "elder_weight_donations",
      "elder_weight_trophies",
      "band_ceiling_share",
      "tenure_min_days",
    ],
    more: [
      "band_floor_share",
      "worthiness_percentile",
      "promote_qualifying_weeks",
      "swap_margin",
      "demote_abandoned_weeks",
      "demote_outranked_weeks",
      "renominate_promotion_days",
      "renominate_demotion_days",
      "war_window_weeks",
      "ranked_window_weeks",
      "donations_window_weeks",
    ],
  },
  {
    key: "quiet",
    title: "When do quiet members get kicked?",
    fields: [
      "removal_enabled",
      "watch_days",
      "at_risk_days",
      "confirm_days",
      "removal_includes_elders",
      "away_max_days",
    ],
    more: [
      "away_suggestions_enabled",
      "contribution_grace_max_days",
      "roster_cap",
      "renominate_removal_days",
      "outcome_window_hours",
    ],
  },
  {
    key: "welcome",
    title: "Welcomes and goodbyes",
    fields: ["welcome_enabled", "departures_enabled"],
    more: [],
  },
  {
    key: "sees",
    title: "What does the clan see?",
    fields: [
      "members_see_standing",
      "announce_awards_enabled",
      "announce_rules_enabled",
    ],
    more: [],
  },
];

const QUESTION_OF = new Map(
  QUESTIONS.flatMap((q) => [...q.fields, ...q.more].map((k) => [k, q.key])),
);

/** The question that asks a field (`null` for a key that is no field). */
export const questionOf = (key) => QUESTION_OF.get(key) ?? null;

/** Each category's weekly goal field, and its words in the editor. */
export const MINIMUM_FIELD = {
  war: "war_min_decks",
  ranked: "ranked_min_battles",
  donations: "donations_min_weekly",
  trophies: "trophies_min",
};

/** A category as a player says it. */
export const CATEGORY_WORDS = {
  war: "War decks",
  ranked: "Ranked battles",
  donations: "Cards donated",
  trophies: "Trophies",
};

/** How strict, in the editor's words. */
export const POSTURE_WORDS = {
  relaxed: "Chill",
  standard: "Steady",
  strict: "Hardcore",
};

/** The roster as band() counts it: one row per Elder, and a fact that
 *  passes for each, so the seats come from the engine's own arithmetic. */
function seatRows(elders) {
  const rows = new Map();
  const facts = new Map();
  for (let i = 0; i < elders; i += 1) {
    const tag = `#seat${i}`;
    rows.set(tag, {
      player_tag: tag,
      role: "elder",
      score: 0,
      tenure_days: 0,
      tenure_known: true,
      values: {},
      pct: {},
    });
    facts.set(tag, { minimums: { passes: true } });
  }
  return { rows, facts };
}

const seatsAt = (values, members, elders) => {
  const { rows, facts } = seatRows(elders);
  return band(rows, facts, members, values);
};

/**
 * The Elder seats this draft makes for a roster of `members` (leadership
 * included) holding `elders` Elders: `{ seats, elders, open, full }`, where
 * `seats` is band()'s upper line. `null` when Elders are chosen by hand or
 * the roster is not known.
 */
export function elderSeats(values, { members, elders } = {}) {
  if (!ranksElder(values)) return null;
  if (!Number.isInteger(members) || members <= 0) return null;
  const have = Number.isInteger(elders) && elders > 0 ? elders : 0;
  const b = seatsAt(values, members, have);
  return {
    seats: b.ceil,
    elders: b.current_elders,
    open: Math.max(0, b.ceil - b.current_elders),
    full: b.ceil <= b.current_elders,
  };
}

/** The smallest whole-percent upper share that opens one seat beyond the
 *  Elders the clan has, or `null` when none up to the whole roster does. */
export function seatShareFor(values, { members, elders }) {
  const from = Math.round(Number(values.band_ceiling_share) * 100) + 1;
  for (let pct = Math.max(from, 1); pct <= 100; pct += 1) {
    const share = pct / 100;
    const b = seatsAt(
      { ...values, band_ceiling_share: share },
      members,
      elders,
    );
    if (b.ceil > b.current_elders) return share;
  }
  return null;
}

/** Whether a counted category does anything: a weekly goal above zero, or
 *  a share of the Elder order. */
function countsFor(values, c) {
  const min = Number(values[MINIMUM_FIELD[c]]) || 0;
  const weighted =
    values.elder_mode === "categories" &&
    (Number(values[`elder_weight_${c}`]) || 0) > 0;
  return min > 0 || weighted;
}

/**
 * The Rules check: plain warnings about a draft, each at the question it
 * belongs to, with a one-tap `fix` (fields to set) where there is one.
 * The validation errors come first, once each, at their field's question.
 * `roster` is `{ members, elders }` (either may be unknown).
 */
export function rulesCheck(values, roster = {}) {
  const out = [];
  const { errors } = validate(values);
  for (const [key, text] of Object.entries(errors))
    out.push({
      kind: "invalid",
      key,
      question: questionOf(key) ?? "about",
      text,
      fix: null,
    });
  if (Object.keys(errors).length > 0) return out;

  const seats = elderSeats(values, roster);
  if (seats?.full) {
    const share = seatShareFor(values, roster);
    const after = share
      ? elderSeats({ ...values, band_ceiling_share: share }, roster)
      : null;
    out.push({
      kind: "seats_full",
      key: "band_ceiling_share",
      question: "elder",
      text:
        seats.elders > seats.seats
          ? `Elder seats are over full. There is room for ${seats.seats} and you have ${seats.elders}, so nobody new can be promoted.`
          : `Elder seats are full. There is room for ${seats.seats} and you have ${seats.elders}, so nobody new can be promoted.`,
      fix:
        share && after
          ? {
              label: `Make room for ${after.seats} (${Math.round(share * 100)}%)`,
              set: { band_ceiling_share: share },
            }
          : null,
    });
  }

  for (const c of countedCategories(values)) {
    if (countsFor(values, c)) continue;
    const words = CATEGORY_WORDS[c];
    const elder =
      values.elder_mode === "categories"
        ? "They count 0% for Elder and have no goal."
        : "They have no goal, and Elders are picked by hand.";
    out.push({
      kind: "counts_nothing",
      key: `${c}_enabled`,
      question: "weekly",
      text: `${words} are on but do nothing. ${elder}`,
      fix: {
        label: `Turn ${words.toLowerCase()} off`,
        set: { [`${c}_enabled`]: false },
      },
    });
  }
  return out;
}

/** The counted categories' Elder weights as whole percents adding to 100,
 *  for the split bar. Empty when no counted category has a weight. */
export function weightShares(values) {
  const cats = countedCategories(values);
  const raw = cats.map((c) => [
    c,
    Math.max(0, Number(values[`elder_weight_${c}`]) || 0),
  ]);
  const total = raw.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return Object.fromEntries(cats.map((c) => [c, 0]));
  return roundTo100(raw.map(([c, w]) => [c, (w * 100) / total]));
}

/** Largest-remainder rounding of shares that add to 100. */
function roundTo100(pairs) {
  const floored = pairs.map(([c, v]) => [c, Math.floor(v), v - Math.floor(v)]);
  let left = 100 - floored.reduce((s, [, v]) => s + v, 0);
  const order = [...floored].sort((a, b) => b[2] - a[2]);
  const bump = new Set();
  for (const [c] of order) {
    if (left <= 0) break;
    bump.add(c);
    left -= 1;
  }
  return Object.fromEntries(
    floored.map(([c, v]) => [c, v + (bump.has(c) ? 1 : 0)]),
  );
}

/**
 * One category's Elder weight set to `share` percent, the other counted
 * categories rebalanced in proportion so the whole adds to 100. Returns the
 * weight fields to set. Evenly shared when the others were all zero.
 */
export function setWeightShare(values, category, share) {
  const cats = countedCategories(values);
  if (!cats.includes(category)) return {};
  const mine = Math.min(100, Math.max(0, Math.round(Number(share) || 0)));
  const others = cats.filter((c) => c !== category);
  if (others.length === 0) return { [`elder_weight_${category}`]: 100 };
  const now = weightShares(values);
  const otherTotal = others.reduce((s, c) => s + (now[c] ?? 0), 0);
  const rest = 100 - mine;
  const spread = others.map((c) => [
    c,
    otherTotal > 0 ? ((now[c] ?? 0) * rest) / otherTotal : rest / others.length,
  ]);
  const rounded = roundTo100([[category, mine], ...spread]);
  rounded[category] = mine;
  const sum = Object.values(rounded).reduce((s, v) => s + v, 0);
  if (sum !== 100) {
    const fixer = others.reduce((a, b) => (rounded[a] >= rounded[b] ? a : b));
    rounded[fixer] += 100 - sum;
  }
  return Object.fromEntries(
    Object.entries(rounded).map(([c, v]) => [`elder_weight_${c}`, v]),
  );
}

/** The policy fields a clan directory tile reads, and nothing else. A saved
 *  version also holds who saved it, their note, and every minimum and
 *  clock; none of those is public. */
export const DIRECTORY_POLICY_FIELDS = [
  "war_intent",
  "posture",
  "goal_together",
  "war_enabled",
  "ranked_enabled",
  "donations_enabled",
  "trophies_enabled",
  "removal_enabled",
  "confirm_days",
];

const INTENTS = new Set(["participating", "not_participating"]);
const POSTURE_KEYS = new Set(["relaxed", "standard", "strict"]);

/**
 * The public part of a policy, as a directory tile shows it: Clan Wars
 * intent, how strict, playing together, what counts, and the day a removal
 * Action comes. The one projection, for the directory read and for the
 * editor's preview of it.
 */
export function directoryPolicy(values) {
  const removal = values?.removal_enabled === true;
  const confirm = Number(values?.confirm_days);
  return {
    war_intent: INTENTS.has(values?.war_intent) ? values.war_intent : "unknown",
    posture: POSTURE_KEYS.has(values?.posture) ? values.posture : null,
    together: values?.goal_together === true,
    counted: countedCategories(values),
    removal_day:
      removal && Number.isInteger(confirm) && confirm > 0 ? confirm : null,
  };
}
