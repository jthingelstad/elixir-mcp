/**
 * The clan's activity in its Discord (Jamie, 2026-10-10): a leader
 * connects a webhook of its own (not the Actions one, not a person's
 * timeline cross-post) and chooses what of the clan's timeline is posted
 * there. Optionally the clan's own model rewrites each line in a voice
 * the leaders describe, so the posts read like the clan and not like a
 * template.
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
 * The rewrite (`activityRewriteRequest`, `activityRewritesFromDraft`) is
 * the one purpose whose words are sent without a person reading them
 * first, because Jamie asked for exactly that. So the model sees only
 * what the line already says (the sentence and its public facts), never
 * anything private to Clan, and every line it writes is checked: a
 * member's name exactly as recorded, no number it was not given, no link
 * or mention. A line that fails keeps Elixir's own sentence.
 *
 * Pure: items and policy values in, decisions and words out.
 */

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

/** A leader's voice text, tidied: one paragraph, no links, at most
 *  VOICE_MAX characters. Empty is no voice (Elixir's plain one). */
export function cleanVoice(text) {
  return String(text ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[<>`@]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VOICE_MAX);
}

/* ------------------------------------------------------------------ */
/* The rewrite                                                         */
/* ------------------------------------------------------------------ */

/** A rewritten line is short: Discord is a channel, not a newsletter. */
export const REWRITE_MAX = 280;
/** Lines rewritten in one request; the relay sends at most this many. */
export const REWRITE_BATCH_MAX = 20;

/** The facts the model may see: what the line already says, as values,
 *  never a tag, an id, an address or anything nested. */
function publicFacts(facts) {
  const out = {};
  for (const [k, v] of Object.entries(facts ?? {})) {
    if (/(_tag|_id|^id|url|_at)$/i.test(k) || k === "evidence") continue;
    if (typeof v === "string" && v.length <= 80) out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** The names a line must keep exactly as recorded. */
export function namesIn(item) {
  const f = item?.facts ?? {};
  return [
    ...new Set(
      [f.name, f.previous_name]
        .filter((n) => typeof n === "string" && n.trim())
        .map((n) => n.trim()),
    ),
  ];
}

/** What one line hands the model: its key, kind, sentence and facts. */
export function rewriteLine(item, sentence) {
  return {
    key: item.id,
    kind: item.kind,
    sentence: String(sentence ?? "").trim(),
    facts: publicFacts(item.facts),
    names: namesIn(item),
  };
}

const REWRITE_TOOL = {
  name: "write_posts",
  description:
    "The clan's Discord posts, one for each line you were given, by its key.",
  input_schema: {
    type: "object",
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "The line's key, as given." },
            text: {
              type: "string",
              description: `The post: one or two sentences, at most ${REWRITE_MAX} characters.`,
            },
          },
          required: ["key", "text"],
        },
      },
    },
    required: ["posts"],
  },
};

const REWRITE_SYSTEM = [
  "You write the posts a Clash Royale clan's Discord channel gets when something happens in the clan: a member joins, earns a badge, has a great session, the clan finishes its war week. Each post retells one line the clan's record wrote, in the clan's own voice. Nobody reads your posts before they are sent.",
  "Rules:",
  "- Keep every fact in the line and add none. Never invent a number, a result, an opponent, a reason, a feeling, a plan or anything about the game you were not told. When the line says little, write little.",
  "- Name members exactly as they are written, every one the line names; never shorten, translate or correct a name.",
  "- Never judge a member: nobody is slacking, disappointing, lazy or in trouble. Celebrate what went well; state the rest plainly.",
  '- A departure says exactly what the line says ("departed", "was removed", "left on their own") and never guesses why.',
  "- No links, @-mentions, hashtags, markdown or code. An emoji is fine when the clan's voice wants one.",
  `- One or two sentences, at most ${REWRITE_MAX} characters each post.`,
  "- Write in English unless the clan's voice asks for another language.",
  "Answer by calling write_posts with one post for every key.",
].join("\n");

/**
 * The request that rewrites a batch of lines: the system words, the
 * prompt, the answer's shape and the output budget. `lines` are
 * `rewriteLine`s; `voice` is the leaders' text (cleanVoice).
 */
export function activityRewriteRequest({
  clanName = null,
  voice = "",
  lines = [],
} = {}) {
  const batch = lines.slice(0, REWRITE_BATCH_MAX);
  const says = cleanVoice(voice);
  const prompt = [
    `The clan: ${clanName ?? "a Clash Royale clan"}.`,
    says
      ? `How its leaders want the posts to sound: ${says}`
      : "Its leaders asked for no particular voice: friendly, plain and brief.",
    "",
    "The lines, each with its key, what kind of moment it is, the record's sentence and the facts behind it:",
    ...batch.map((l) =>
      JSON.stringify({
        key: l.key,
        kind: l.kind,
        sentence: l.sentence,
        facts: l.facts,
      }),
    ),
  ].join("\n");
  return {
    purpose: "discord_activity",
    max_tokens: Math.min(4000, 200 + 160 * batch.length),
    system: REWRITE_SYSTEM,
    prompt,
    tool: REWRITE_TOOL,
  };
}

const numbersIn = (text) =>
  String(text ?? "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .match(/\d+(?:\.\d+)?/g) ?? [];

/** A model's post, tidied: no links, no mass mention, one line. Its
 *  markdown characters stay (a member's name may hold `_` or `*`); the
 *  sender escapes the whole post, so none of them styles the channel. */
const tidy = (v) =>
  String(v ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[<>]+/g, "")
    .replace(/@(everyone|here)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Why a rewritten line is refused, or null when it may be posted: every
 * name kept exactly, no number the line did not give, within the limit.
 */
export function rewriteProblem(line, text) {
  if (!text) return "empty";
  if (text.length > REWRITE_MAX) return "too_long";
  for (const name of line.names ?? [])
    if (!text.includes(tidy(name))) return "name_changed";
  const known = new Set(
    numbersIn(
      `${line.sentence} ${Object.values(line.facts ?? {}).join(" ")}`,
    ).map(Number),
  );
  if (numbersIn(text).some((n) => !known.has(Number(n))))
    return "number_invented";
  return null;
}

/**
 * The model's answer as the posts that passed, by key. A line missing
 * from the answer, or one that fails `rewriteProblem`, is left out: its
 * post keeps Elixir's own sentence. `refused` counts the reasons.
 */
export function activityRewritesFromDraft(input, lines) {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const posts = Array.isArray(input?.posts) ? input.posts : [];
  const out = new Map();
  const refused = {};
  for (const p of posts) {
    const line = byKey.get(p?.key);
    if (!line || out.has(line.key)) continue;
    // Never clipped: a post cut short is refused, never sent.
    const text = tidy(p.text);
    const problem = rewriteProblem(line, text);
    if (problem) refused[problem] = (refused[problem] ?? 0) + 1;
    else out.set(line.key, text);
  }
  return { rewrites: out, refused };
}
