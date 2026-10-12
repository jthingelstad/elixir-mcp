/**
 * The clan's activity channel with the clan's own model: an editor, not
 * a rewriter (Jamie, 2026-10-11: "it can't just be syndication of the
 * timeline ... it can either use AI or it can use some code to figure
 * out a better way to frame up what's happening"; approved as "read-only
 * research on the clan's record, may skip and merge items, no time or
 * links, checked against what it read").
 *
 * A run's stories (`buildStories`, each with Elixir's own render) go to
 * the model as packets. In up to `EDITOR_ROUNDS` rounds it may look
 * things up in the clan's record (`EDITOR_LOOKUPS`, run by the sync,
 * read-only), and then answers once: posts, each telling one story or
 * several told together, and skips, each with a reason. A story it
 * neither posts nor skips is posted in Elixir's words, and so is a post
 * the checks refuse.
 *
 * The checks (`editorProblem`): no link, mention or clock time; within
 * `EDITOR_POST_MAX`; every name a story's render says kept exactly; no
 * number and no proper name that neither the clan, the stories nor the
 * lookups it made hold; a departure keeps Elixir's sentence for it word
 * for word ("departed", "was removed", "left on their own") and adds
 * only a thank-you or a farewell (`FAREWELL`), never a reason. A departure, a leader's word on one and an edit of a post
 * already in the channel are never merged, and a departure is never
 * skipped. A post that names a story another post already told is
 * refused whole.
 *
 * Pure: packets, requests and answers in and out; the sync runs the
 * lookups and the model service sends the requests.
 */

import {
  inventedNumbers,
  itemFactLines,
  memberLines,
  strictTool,
  unknownNames,
} from "./context.mjs";
import { DEPARTURE_CLASSIFIED, namesIn, rewriteText } from "./activity.mjs";

/** Rounds of one run: lookups in the first two, the answer by the last. */
export const EDITOR_ROUNDS = 3;
/** A post, at most: a story or a few told together. */
export const EDITOR_POST_MAX = 600;
/** Stories one run hands the model; the rest are Elixir's own. */
export const EDITOR_STORIES_MAX = 12;
/** Lookups run in one round; more are answered "not looked up". */
export const EDITOR_LOOKUPS_MAX = 6;
/** One lookup's answer, at most, in characters. */
export const EDITOR_RESULT_MAX = 1500;
/** A member's posts today shown with a story, at most, and each one's
 *  words, at most. */
export const EDITOR_TODAY_MAX = 3;
export const EDITOR_TODAY_TEXT_MAX = 300;
/** A skip's reason as a leader reads it on the page. */
export const EDITOR_SKIP_REASON_MAX = 120;
/** How hard the model thinks (Claude's `effort`): the checks, not its
 *  care, keep the posts true. */
export const EDITOR_EFFORT = "low";

/** What the model may look up: read-only, the clan's record as its
 *  members could read it, never anything private to Clan. */
export const EDITOR_LOOKUPS = {
  member_record: {
    name: "member_record",
    description:
      "What Elixir records about one current member of the clan, by their name exactly as written: role, trophies and best, arena, career wins, collection level, time in the clan and earlier stints, war weeks as decks and points, the clan's awards they hold and their recent moments.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The member's name, exactly as written.",
        },
      },
    },
  },
  member_battles: {
    name: "member_battles",
    description:
      "A current member's battles in the last 7 days, newest first, at most 10: the mode, the result and crowns, the opponent, the deck by its archetype, the trophy change and roughly when.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The member's name, exactly as written.",
        },
        mode: {
          type: "string",
          enum: ["any", "ladder", "ranked", "war"],
          description: "One mode, or any.",
        },
      },
    },
  },
  channel_recent: {
    name: "channel_recent",
    description:
      "What this channel posted in the last 3 days, newest first, at most 15 posts: to connect a story to an earlier one, or to avoid saying the same thing again.",
    input_schema: { type: "object", properties: {} },
  },
};

const ANSWER = {
  name: "write_posts",
  description:
    "The channel's posts for these stories, and the stories not worth a post.",
  input_schema: {
    type: "object",
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keys: {
              type: "array",
              items: { type: "string" },
              description:
                "The STORY keys this post tells: one, or several told together.",
            },
            text: {
              type: "string",
              description: `The post: one to three sentences, at most ${EDITOR_POST_MAX} characters.`,
            },
          },
        },
      },
      skips: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "The STORY key, as given." },
            reason: {
              type: "string",
              description:
                "Why it is not worth a post, in a few words a leader reads.",
            },
          },
        },
      },
    },
  },
};

export const EDITOR_ANSWER = ANSWER.name;

/** The editor's instructions; a preview has no lookups. */
const system = ({ lookups = true } = {}) =>
  [
    "You are the editor of a Clash Royale clan's Discord channel. Elixir, which records the clan, hands you what happened in the clan in the last few minutes as STORIES: each has Elixir's own version, the facts behind it and what the record knows about its member. You decide what is worth a post and tell it well, in the clan's voice. Nobody reads your posts before they are sent.",
    "You may:",
    lookups
      ? "- Look things up first, when a fact would make a story better: member_record (a member's record), member_battles (a member's battles this week: a streak, a rival, a deck's run) and channel_recent (what the channel already said). Lookups are optional; most stories need none."
      : null,
    "- Tell several stories in one post when they belong together (members reaching the same arena, one member's milestones from one session), listing every key the post tells.",
    "- Skip a story not worth a post (a small step, something the channel just said) with a short reason. A story you neither post nor skip is posted in Elixir's version.",
    "Rules:",
    `- Every name, number and event comes from THE CLAN${lookups ? ", a STORY or a lookup's answer" : " or a STORY"}. Never invent a result, an opponent, a reason, a feeling or a plan. When the facts say little, write little.`,
    "- Name members and opponents exactly as written; never shorten, translate or correct a name. Keep every name a story's version says.",
    "- Never judge a member: nobody is slacking, disappointing, lazy or in trouble. Celebrate what went well; state the rest plainly. A member's share of the clan's fame is never told.",
    '- A departure is never skipped and never told with another story. Keep its version\'s sentence word for word; around it you may add only a short thank-you or farewell ("Thanks for everything!", "Good luck out there!"), never a reason, a guess at why or anything else.',
    "- A story marked EDIT is already in the channel and grew: its post is edited, so tell it alone and never skip it.",
    "- TOLD TODAY lists what the channel already posted about a member today. Never tell it again: skip a story that only repeats it, or tell only what is new.",
    '- No clock time: never say at what time something happened. A story marked LATE happened a while ago: its post must say when in the words its LATE line gives ("earlier today", "yesterday", "3 days ago").',
    "- No links, @-mentions, hashtags, markdown or code. An emoji is fine when the clan's voice wants one.",
    `- One to three sentences, at most ${EDITOR_POST_MAX} characters a post.`,
    "- Write in English unless the clan's voice asks for another language.",
    `Answer by calling ${ANSWER.name} once.`,
  ]
    .filter(Boolean)
    .join("\n");

/** How late Elixir's version says a story is (`whenWords`, its prefix),
 *  or null: a late story's post must say it too. */
const LATE = /^(Earlier today|Yesterday|\d+ days ago): /;
const lateWords = (render) => LATE.exec(String(render ?? ""))?.[1] ?? null;

/** The sentence of Elixir's version that tells the departure, kept word
 *  for word in the model's post (without the version's "when"). */
const departureSentence = (render) =>
  String(render ?? "")
    .replace(LATE, "")
    .split(/(?<=[.!?])\s+/)
    .find((x) => /\b(?:departed|was removed|left)\b/.test(x))
    ?.trim() ?? null;

/** What the record says a departure must say, or null. */
function departureWord(items) {
  const c = items.find((it) => it.kind === DEPARTURE_CLASSIFIED);
  if (c) return c.facts?.kind === "kick" ? "kick" : "leave";
  return items.some((it) => it.kind === "member_left") ? "departed" : null;
}

/**
 * One story as the model reads it. `post` is the sync's planned post
 * (`key`, `story`, `render`); `edit` when its message is already in the
 * channel (a story that grew, or a departure a leader's word edits).
 * `members` are the records of its members (`memberLines`; a departure's
 * is its contribution only), `history` how often the channel told of
 * them this week, and `today` what it posted about them today
 * (`[{ name, posts: [{ ago, text }] }]`, its other posts, newest first).
 */
export function editorStory(
  post,
  { members = [], history = [], edit = false, today = [] } = {},
) {
  const items = post.story.items;
  const departure = departureWord(items);
  const kinds = [...new Set(items.map((it) => it.kind))];
  const head = [
    `STORY ${post.key} (${kinds.join(", ").replaceAll("_", " ")}${items.length > 1 ? `; ${items.length} moments` : ""})`,
  ];
  if (edit)
    head.push("EDIT: this post is already in the channel; tell it alone.");
  const late = lateWords(post.render);
  if (late)
    head.push(
      `LATE: this happened ${/^\d/.test(late) ? late : late.toLowerCase()}; the post must say "${late.toLowerCase()}", never a time of day.`,
    );
  const must = departure ? departureSentence(post.render) : null;
  if (departure)
    head.push(
      must
        ? `A departure: keep this sentence word for word, and give no reason: ${must}`
        : `A departure: say ${departure === "kick" ? '"was removed"' : departure === "leave" ? '"left on their own"' : '"departed"'}, as Elixir's version does, and give no reason.`,
    );
  const lines = [...head, `Elixir's version: ${post.render}`];
  items.forEach((it, i) => {
    const facts = itemFactLines(it.facts);
    if (facts.length)
      lines.push(
        items.length > 1 ? `Facts of moment ${i + 1}:` : "Facts:",
        ...facts.map((f) => `- ${f}`),
      );
  });
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
  for (const t of today.filter((x) => x?.posts?.length))
    lines.push(
      `TOLD TODAY about ${t.name}:`,
      ...t.posts.slice(0, EDITOR_TODAY_MAX).map(
        (p) =>
          `- ${p.ago}: ${String(p.text ?? "")
            .replace(/\s+/g, " ")
            .slice(0, EDITOR_TODAY_TEXT_MAX)}`,
      ),
    );
  return {
    key: post.key,
    render: post.render,
    names: [...new Set(items.flatMap((it) => namesIn(it, post.render)))],
    departure,
    must,
    late,
    alone: Boolean(departure || edit),
    packet: lines.join("\n"),
  };
}

const roundNote = (round) =>
  round >= EDITOR_ROUNDS
    ? `Round ${round} of ${EDITOR_ROUNDS}: no more lookups. Answer now by calling ${ANSWER.name}.`
    : `Round ${round} of ${EDITOR_ROUNDS}: look up what would make a story better, or answer now by calling ${ANSWER.name}.`;

/**
 * The first round's request. `context` is the clan (`clanContext`, the
 * cached prefix every request of the clan shares); `stories` are
 * `editorStory`s.
 */
export function editorRequest({ context = "", stories = [] } = {}) {
  const batch = stories.slice(0, EDITOR_STORIES_MAX);
  return {
    purpose: "discord_activity",
    effort: EDITOR_EFFORT,
    max_tokens: Math.min(4000, 400 + 250 * batch.length),
    system: system(),
    context: String(context ?? ""),
    messages: [
      {
        role: "user",
        content: `${batch.map((s) => s.packet).join("\n\n")}\n\n${roundNote(1)}`,
      },
    ],
    tools: [...Object.values(EDITOR_LOOKUPS), ANSWER].map(strictTool),
    answer: ANSWER.name,
  };
}

/**
 * A leader's preview of the editor (2026-10-11): the same stories and
 * checks in one request, as a leader's draft (`prompt` and its one tool,
 * the answer), with no lookups. Nothing it writes is posted.
 */
export function editorPreviewRequest({ context = "", stories = [] } = {}) {
  const batch = stories.slice(0, EDITOR_STORIES_MAX);
  return {
    purpose: "discord_activity",
    effort: EDITOR_EFFORT,
    max_tokens: Math.min(4000, 400 + 250 * batch.length),
    system: system({ lookups: false }),
    context: String(context ?? ""),
    prompt: `${batch.map((s) => s.packet).join("\n\n")}\n\nThis is a preview for the clan's leaders, with no lookups. Answer now by calling ${ANSWER.name}.`,
    tool: strictTool(ANSWER),
  };
}

/**
 * The next round's request: the model's turn as it was (its thinking
 * included, unchanged), then each lookup's answer and the round's note.
 * `results` are `{ id, text }`, one for every lookup it asked for.
 */
export function editorNext(request, reply, results, round) {
  return {
    ...request,
    messages: [
      ...request.messages,
      { role: "assistant", content: reply.content },
      {
        role: "user",
        content: [
          ...results.map((r) => ({
            type: "tool_result",
            tool_use_id: r.id,
            content: String(r.text ?? "").slice(0, EDITOR_RESULT_MAX),
          })),
          { type: "text", text: roundNote(round) },
        ],
      },
    ],
  };
}

// A time of day: 6:05, 18:05, 6pm, 6.05 pm, and a dotted or "h" time
// after a word that sets a time ("at 18.05", "around 6h30"). A decimal
// alone ("3.25") is not.
const CLOCK =
  /\b\d{1,2}:\d{2}\b|\b\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)\b|\b(?:at|by|around|about|before|after|until|till|since|from|near)\s+(?:about\s+)?\d{1,2}[.h]\d{2}\b/i;
/** The only words a departure's post may add to Elixir's sentence: a
 *  thank-you or a farewell. Anything else could be a reason the record
 *  never gave, so it is refused rather than guessed at (Codex on #506). */
const FAREWELL = new Set(
  "thank thanks you good luck best of all the farewell goodbye bye so long take care safe travels gg we we'll ll miss see around out there for everything your time help donations battles in arena on ladder and wishing wish well".split(
    " ",
  ),
);
const farewellOnly = (rest, names) => {
  let t = rest;
  for (const n of names) t = t.split(rewriteText(n)).join(" ");
  t = t
    .toLowerCase()
    // A whole emoji: its skin tone, a flag's letters, a tag sequence's tags.
    .replace(
      /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u{FE0F}|\u{200D}|[\u{E0020}-\u{E007F}]/gu,
      " ",
    )
    .replace(/[’]/g, "'");
  // Only English letters, an apostrophe and plain punctuation are left
  // to check: any other script, a digit or a symbol is not a farewell we
  // can read, so it is refused rather than deleted (Codex on #507).
  if (/[^a-z'\s.,!?;:\-–—]/.test(t)) return false;
  return t
    .replace(/[^a-z']+/g, " ")
    .split(" ")
    .filter(Boolean)
    .every((w) => FAREWELL.has(w));
};
/** Words that give a departure a reason the record never gave. */
const REASON =
  /\b(?:because|due to|reasons?|why|inactiv\w*|kick(?:ed)?|bann?(?:ed)?|for not|for being|for lack|rules?|warn(?:ed|ings?)?)\b/i;
const MUST = {
  departed: [/\bdeparted\b/i, /\b(?:removed|kicked|left)\b/i],
  kick: [/\bremoved\b/i, /\bleft\b/i],
  leave: [/\bleft\b/i, /\b(?:removed|kicked)\b/i],
};

/**
 * Why a post is refused, or null when it may be posted. `stories` are
 * the stories it tells; `read` is everything the model was given or
 * looked up this run (the clan, every packet, every lookup's answer).
 */
export function editorProblem(stories, raw, read = "") {
  const text = rewriteText(raw);
  if (!text) return "empty";
  if (
    /https?:\/\/|www\.|\]\(|\b[a-z0-9-]+\.(?:com|gg|net|org|io|xyz)\b/i.test(
      String(raw),
    )
  )
    return "link";
  if (/@(everyone|here)\b|<[@#]|(^|\s)@\w/i.test(String(raw))) return "mention";
  if (text.length > EDITOR_POST_MAX) return "too_long";
  if (CLOCK.test(text)) return "clock_time";
  for (const s of stories)
    if (s.late && !text.toLowerCase().includes(s.late.toLowerCase()))
      return "when_dropped";
  for (const name of stories.flatMap((s) => s.names))
    if (!text.includes(rewriteText(name))) return "name_changed";
  const told = `${read}\n${stories.map((s) => s.packet).join("\n")}`;
  if (inventedNumbers(text, told).length) return "number_invented";
  if (unknownNames(text, told).length) return "name_invented";
  for (const s of stories) {
    if (!s.departure) continue;
    const must = MUST[s.departure];
    if (must && (!must[0].test(text) || must[1].test(text)))
      return "departure_words";
    if (s.must && !text.includes(rewriteText(s.must))) return "departure_words";
    if (REASON.test(text.replace(rewriteText(s.must ?? ""), "")))
      return "departure_words";
    if (s.must) {
      // Around Elixir's sentence: its other sentences, when, and a farewell.
      let rest = text.replace(rewriteText(s.must), " ");
      for (const x of rewriteText(s.render)
        .replace(LATE, "")
        .split(/(?<=[.!?])\s+/))
        if (x.trim()) rest = rest.split(x.trim()).join(" ");
      if (s.late) rest = rest.replace(new RegExp(s.late, "i"), " ");
      if (!farewellOnly(rest, s.names)) return "departure_words";
    }
  }
  return null;
}

const reasonText = (v) =>
  rewriteText(v)
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[@`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EDITOR_SKIP_REASON_MAX)
    .trim();

/**
 * The model's answer as what the run posts and skips. `posts` are
 * `{ key, keys, text }`, `key` the earliest story it tells (the post's
 * key; the others are told inside it); `skips` are `{ key, reason }`. A
 * story in neither is Elixir's own. `refused` counts the reasons a post
 * or a skip was not taken, and `rejected` lists them (`{ keys, why,
 * text }`, the refused words) for a leader's preview and the quality
 * ledger.
 */
export function editorAnswer(input, stories, read = "") {
  const order = new Map(stories.map((s, i) => [s.key, i]));
  const byKey = new Map(stories.map((s) => [s.key, s]));
  const used = new Set();
  const posts = [];
  const skips = [];
  const refused = {};
  const rejected = [];
  // The refused words are kept with the reason (the quality ledger,
  // 0222): an operator reads what the checks stopped, not just a count.
  const refuse = (why, keys, text) => {
    refused[why] = (refused[why] ?? 0) + 1;
    rejected.push({
      keys,
      why,
      ...(typeof text === "string" ? { text: text.slice(0, 4000) } : {}),
    });
  };
  for (const p of Array.isArray(input?.posts) ? input.posts : []) {
    const keys = [
      ...new Set(
        (Array.isArray(p?.keys) ? p.keys : []).filter((k) => byKey.has(k)),
      ),
    ].sort((a, b) => order.get(a) - order.get(b));
    if (!keys.length) continue;
    // A story already told: the post would tell it twice. Refused whole,
    // never trimmed to the rest, since its words still tell it.
    if (keys.some((k) => used.has(k))) {
      refuse("key_reused", keys, p.text);
      continue;
    }
    const list = keys.map((k) => byKey.get(k));
    if (list.length > 1 && list.some((s) => s.alone)) {
      refuse("merge_refused", keys, p.text);
      continue;
    }
    const problem = editorProblem(list, p.text, read);
    if (problem) {
      refuse(problem, keys, p.text);
      continue;
    }
    for (const k of keys) used.add(k);
    posts.push({ key: keys[0], keys, text: rewriteText(p.text) });
  }
  for (const k of Array.isArray(input?.skips) ? input.skips : []) {
    const s = byKey.get(k?.key);
    if (!s || used.has(s.key)) continue;
    // A departure is always told, and an edit keeps its post right.
    if (s.alone) {
      refuse("skip_refused", [s.key], k.reason);
      continue;
    }
    used.add(s.key);
    skips.push({
      key: s.key,
      reason: reasonText(k.reason) || "not worth a post",
    });
  }
  return { posts, skips, refused, rejected };
}
