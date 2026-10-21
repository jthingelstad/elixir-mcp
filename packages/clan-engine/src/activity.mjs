/**
 * The clan's activity in its Discord (Jamie, 2026-10-10): a leader
 * connects a webhook of its own (not the Actions one, not a person's
 * timeline cross-post) and chooses what of the clan's timeline is posted
 * there. Optionally the clan's own model edits the channel in a voice
 * the leaders describe (`editor.mjs`).
 *
 * What is posted is the clan's timeline as its members read it (the
 * clan-visible items, never a leaders-only one), in three categories a
 * leader switches. The clan's policy sets the defaults and can rule a
 * category out: a clan that does not take part in Clan Wars has no war
 * posts. Nothing runs until the clan has a policy.
 *
 * A departure is the roster's (`member_left`: the member departed) until
 * a leader says which it was; that classification is never a post of its
 * own, it edits the departure's post to say "was removed" or "left on
 * their own" (Jamie: a kick is never told as a leave).
 *
 * The editor (`editor.mjs`) is the one purpose whose words are sent
 * without a person reading them first, because Jamie asked for exactly
 * that. Here are the voice and the words both it and Elixir's own render
 * share: the names a post must keep (`namesIn`) and a model's post
 * tidied (`rewriteText`).
 *
 * Pure: items and policy values in, decisions and words out.
 */

import { namesInFacts } from "./context.mjs";

/** The timeline's item kinds in each category a leader switches. */
export const ACTIVITY_CATEGORIES = {
  members: {
    label: "Members",
    why: "Who joins and who departs (said as removed or left once a leader answers the departure), and role changes made in the game.",
    kinds: ["member_joined", "member_left", "member_role_changed"],
  },
  milestones: {
    label: "Milestones",
    why: "Members' standout sessions, badges, arenas, ranked promotions, new bests, collection levels, career wins and card unlocks, and the clan's own awards.",
    kinds: [
      "session_standout",
      "badge_earned",
      "legendary_badge_earned",
      "arena_changed",
      "ranked_promotion",
      "best_trophies_band",
      "collection_level_step",
      "career_wins_step",
      "card_unlocked",
      "card_form_unlocked",
      "award_granted",
    ],
  },
  war: {
    label: "Clan Wars",
    why: "The week's bracket, the boat crossing the finish line, and how the week finished.",
    kinds: ["bracket_observed", "race_finished", "week_resolved"],
  },
};

export const ACTIVITY_CATEGORY_KEYS = Object.keys(ACTIVITY_CATEGORIES);

const CATEGORY_OF = new Map(
  Object.entries(ACTIVITY_CATEGORIES).flatMap(([key, c]) =>
    c.kinds.map((kind) => [kind, key]),
  ),
);

/** The leader's word on a departure: it edits that departure's post. */
export const DEPARTURE_CLASSIFIED = "departure_classified";

/** The category an item belongs to, or null when it is never posted. */
export const activityCategory = (item) =>
  item?.kind === DEPARTURE_CLASSIFIED
    ? "members"
    : (CATEGORY_OF.get(item?.kind) ?? null);

/**
 * What the clan's policy says about each category: its default, and
 * whether it is ruled out (with the reason a leader reads). `values` is
 * the saved policy's values; no policy means nothing can be turned on.
 */
export function activityPolicy(values) {
  if (!values)
    return {
      ready: false,
      defaults: { members: false, milestones: false, war: false },
      ruled_out: {},
    };
  const intent = values.war_intent ?? "unknown";
  const ruledOut = {};
  if (intent === "not_participating")
    ruledOut.war =
      "The clan's policy says it does not take part in Clan Wars, so there is no war to post.";
  return {
    ready: true,
    defaults: {
      members: true,
      milestones: true,
      // On only when the leaders say the clan takes part; not specified
      // is off until a leader turns it on.
      war: intent === "participating",
    },
    ruled_out: ruledOut,
  };
}

/** The categories in effect: a leader's choice where made, else the
 *  policy's default, never one the policy rules out. */
export function activityCategories(saved, values) {
  const { ready, defaults, ruled_out: ruledOut } = activityPolicy(values);
  const out = {};
  for (const key of ACTIVITY_CATEGORY_KEYS)
    out[key] =
      ready &&
      !ruledOut[key] &&
      (typeof saved?.[key] === "boolean" ? saved[key] : defaults[key]);
  return out;
}

/** Whether an item is posted under the categories in effect. */
export const activityShareable = (item, categories) => {
  const c = activityCategory(item);
  return Boolean(c && categories?.[c]);
};

/** How the leaders want the posts to sound, in their words. */
export const VOICE_MAX = 400;

/** A leader's voice text, tidied: one paragraph, no links or mentions,
 *  not yet bounded, so the clan's voice setting (2026-10-20) can refuse
 *  words over VOICE_MAX rather than cut them. Empty is no voice
 *  (Elixir's plain one). */
export function tidyVoice(text) {
  return String(text ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[<>`@]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A voice tidied and held to VOICE_MAX characters: a preview's trial
 *  voice, which is never saved. */
export function cleanVoice(text) {
  return tidyVoice(text).slice(0, VOICE_MAX);
}

/* ------------------------------------------------------------------ */
/* The editor's words                                                  */
/* ------------------------------------------------------------------ */

/** The names a line must keep exactly as recorded: the member's own, and
 *  every player or clan its sentence names (an opponent, a teammate, a
 *  rival). An arena's, a league's or a card's name may be said freely,
 *  but only as the facts spell it (`unknownNames`). */
export function namesIn(item, sentence = "") {
  const f = item?.facts ?? {};
  const said = String(sentence ?? "");
  return [
    ...new Set(
      [
        f.name,
        ...namesInFacts(f, { people: true }).filter((n) => said.includes(n)),
      ]
        .filter((n) => typeof n === "string" && n.trim())
        .map((n) => n.trim()),
    ),
  ];
}

/** A model's post, tidied: no mass mention, no angle brackets, one line.
 *  A link is refused before this, never stripped. Its markdown characters
 *  stay (a member's name may hold `_` or `*`); the sender escapes the
 *  whole post, so none of them styles the channel. */
export const rewriteText = (v) =>
  String(v ?? "")
    .replace(/[<>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
