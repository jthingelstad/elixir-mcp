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
 * first, because Jamie asked for exactly that. The model is given what
 * the clan's members could read for themselves (Jamie, 2026-10-11): the
 * clan (`clanContext`), each moment's facts and its member's record
 * (`context.mjs`), never anything private to Clan. Every post it writes
 * is checked: the names its line says kept exactly, no number or proper
 * name that is not in what it was given, no link or mention. A post that
 * fails keeps Elixir's own sentence.
 *
 * Pure: items and policy values in, decisions and words out.
 */

import {
  inventedNumbers,
  itemFactLines,
  memberLines,
  namesInFacts,
  strictTool,
  unknownNames,
} from "./context.mjs";

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

/** A rewritten post is short: Discord is a channel, not a newsletter. */
export const REWRITE_MAX = 280;
/** A post that tells a run of same-kind moments at once. */
export const REWRITE_GROUP_MAX = 500;
/** Posts rewritten in one request; the relay sends at most this many. */
export const REWRITE_BATCH_MAX = 20;
/** How hard the model thinks for the posts (Claude's `effort`): `low`.
 *  They are many, short and posted inside a sync with a deadline, and the
 *  checks below, not the model's care, keep them true. */
export const ACTIVITY_EFFORT = "low";

/** Kinds told one at a time even in a run: each is its own story. */
const NEVER_GROUPED = new Set(["session_standout", "legendary_badge_earned"]);
/** Milestones of one kind that arrive together are one post. */
export const groupable = (item) =>
  activityCategory(item) === "milestones" && !NEVER_GROUPED.has(item?.kind);

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

/**
 * What one post hands the model: its key, kind, Elixir's sentence, the
 * facts behind it and, when the record has them, its member's lines
 * (`memberLines`) and how often the channel heard about them this week.
 * `items` is one item, or a run of same-kind milestones told as one post
 * (keyed by the first).
 */
export function rewriteLine(
  items,
  sentences,
  { members = [], history = [] } = {},
) {
  const list = Array.isArray(items) ? items : [items];
  const said = (Array.isArray(sentences) ? sentences : [sentences]).map((s) =>
    String(s ?? "").trim(),
  );
  const grouped = list.length > 1;
  const lines = [
    `POST ${list[0].id} (${list[0].kind}${grouped ? `: ${list.length} moments ${list.every((it) => it.kind === list[0].kind) ? "of this kind " : ""}together; write ONE post that tells all of them` : ""})`,
    ...said.map((s) => `Elixir's line: ${s}`),
  ];
  list.forEach((it, i) => {
    const facts = itemFactLines(it.facts);
    if (facts.length)
      lines.push(
        grouped ? `Facts of moment ${i + 1}:` : "Facts:",
        ...facts.map((f) => `- ${f}`),
      );
  });
  // A member's record, as `memberLines` tells it; a departure's is their
  // time in the clan and what they gave (`scope: "contribution"`).
  for (const m of members.filter(Boolean))
    lines.push(
      ...memberLines(m, { label: "ABOUT", scope: m.scope ?? "full" }).map(
        (l, i) => (i ? `- ${l}` : l),
      ),
    );
  for (const h of history.filter((x) => x?.count > 0))
    lines.push(
      `The channel already told ${h.count} other ${h.kind.replaceAll("_", " ")} post${h.count === 1 ? "" : "s"} about ${h.name} in the last 7 days.`,
    );
  return {
    key: list[0].id,
    kind: list[0].kind,
    sentence: said.join(" "),
    max: grouped ? REWRITE_GROUP_MAX : REWRITE_MAX,
    names: [...new Set(list.flatMap((it, i) => namesIn(it, said[i] ?? "")))],
    packet: lines.join("\n"),
  };
}

const REWRITE_TOOL = {
  name: "write_posts",
  description:
    "The clan's Discord posts, one for each POST you were given, by its key.",
  input_schema: {
    type: "object",
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "The post's key, as given." },
            text: {
              type: "string",
              description: `The post: one or two sentences, at most ${REWRITE_MAX} characters (${REWRITE_GROUP_MAX} for a post that tells several moments).`,
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
  "You write the posts a Clash Royale clan's Discord channel gets when something happens in the clan: a member joins, earns a badge, has a great session, the clan finishes its war week. Each post tells one moment from the clan's record, in the clan's own voice. Nobody reads your posts before they are sent.",
  "After these instructions comes THE CLAN, then each POST: Elixir's plain line, the facts behind it and, for a member, what the record knows about them. All of it is verified. Use it: pick the one or two details that make the moment a story (the deciding battle and who it beat, the best it set, who carried the war week, a returning member's earlier time here) and leave the rest. Never list statistics.",
  "Rules:",
  "- Every name, number and event comes from that POST's facts or THE CLAN. Never invent a result, an opponent, a reason, a feeling or a plan. When the facts say little, write little.",
  "- Name members and opponents exactly as written; never shorten, translate or correct a name. Keep the name of everyone Elixir's line names.",
  "- Never judge a member: nobody is slacking, disappointing, lazy or in trouble. Celebrate what went well; state the rest plainly. A member's share of the clan's fame is never told.",
  '- A departure says exactly what the line says ("departed", "was removed", "left on their own") and never guesses why.',
  "- No links, @-mentions, hashtags, markdown or code. An emoji is fine when the clan's voice wants one.",
  `- One or two sentences, at most ${REWRITE_MAX} characters a post; a POST that tells several moments may take up to ${REWRITE_GROUP_MAX} and must name each member it tells.`,
  "- Write in English unless the clan's voice asks for another language.",
  "Answer by calling write_posts with one post for every key.",
].join("\n");

/**
 * The request that rewrites a batch of posts. `context` is the clan
 * (`clanContext`, with the leaders' voice for the channel), the prefix
 * every request of the clan shares; `lines` are `rewriteLine`s.
 */
export function activityRewriteRequest({ context = "", lines = [] } = {}) {
  const batch = lines.slice(0, REWRITE_BATCH_MAX);
  return {
    purpose: "discord_activity",
    effort: ACTIVITY_EFFORT,
    max_tokens: Math.min(4000, 200 + 200 * batch.length),
    system: REWRITE_SYSTEM,
    context: String(context ?? ""),
    prompt: batch.map((l) => l.packet).join("\n\n"),
    tool: strictTool(REWRITE_TOOL),
  };
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

/**
 * Why a rewritten post is refused, or null when it may be posted: no
 * link or mention, every name its line says kept exactly, no number and
 * no proper name that neither the post's packet nor the clan holds,
 * within its limit. `context` is the request's clan block.
 */
export function rewriteProblem(line, raw, context = "") {
  const text = rewriteText(raw);
  if (!text) return "empty";
  if (
    /https?:\/\/|www\.|\]\(|\b[a-z0-9-]+\.(?:com|gg|net|org|io|xyz)\b/i.test(
      String(raw),
    )
  )
    return "link";
  if (/@(everyone|here)\b|<[@#]/i.test(String(raw))) return "mention";
  if (text.length > (line.max ?? REWRITE_MAX)) return "too_long";
  for (const name of line.names ?? [])
    if (!text.includes(rewriteText(name))) return "name_changed";
  const told = `${context}\n${line.packet ?? line.sentence ?? ""}`;
  if (inventedNumbers(text, told).length) return "number_invented";
  if (unknownNames(text, told).length) return "name_invented";
  return null;
}

/**
 * The model's answer as the posts that passed, by key. A post missing
 * from the answer, or one that fails `rewriteProblem`, is left out: it
 * keeps Elixir's own sentence. `refused` counts the reasons.
 */
export function activityRewritesFromDraft(input, lines, context = "") {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const posts = Array.isArray(input?.posts) ? input.posts : [];
  const out = new Map();
  const refused = {};
  for (const p of posts) {
    const line = byKey.get(p?.key);
    if (!line || out.has(line.key)) continue;
    // Never clipped: a post cut short is refused, never sent.
    const problem = rewriteProblem(line, p.text, context);
    if (problem) refused[problem] = (refused[problem] ?? 0) + 1;
    else out.set(line.key, rewriteText(p.text));
  }
  return { rewrites: out, refused };
}
