/**
 * Words by the clan's own model (2026-09-25): what a clan's own Anthropic
 * key may be used for, the request for each use, and the check on each
 * answer. A model writes WORDS, never judgments (docs/product/clan.md,
 * principle 8; DECISIONS, "Clan drafts words; people decide"). It runs
 * only on the clan's own key: Elixir funds no model use, and its own
 * voice is code (docs/product/mail.md, "Elixir's own voice is
 * deterministic"):
 *
 *  - the uses are a closed list (`PURPOSES`); no judgment about a member
 *    is ever one of them;
 *  - a request carries what Elixir knows (Jamie, 2026-10-11, reversing
 *    "the model sees only the line"): the clan (`clanContext`), the
 *    moment and the member it is about, by name, with their record
 *    (`context.mjs`), and the leader's note (the draft's "What should
 *    it say?") as written. Never a note saved on an Action (anyone's), a hold, a removal's rationale or inactivity numbers,
 *    fame per member, or anything else private to Clan beyond the
 *    Action's own evidence;
 *  - a draft for an Action (2026-10-20) is given the words Elixir would
 *    send without one as its floor, and takes its destination's shape:
 *    clan-chat lines (`clanChatRequest`), or a title and a message
 *    (`leaderMessageRequest`);
 *  - every answer is checked here and handed to a person to edit and
 *    save, with a warning on any number or name it was not given, and
 *    on a draft that says less than the plain words.
 *    Nothing a model writes is saved or sent by itself, with one
 *    exception Jamie asked for (2026-10-10): the clan's activity posts in
 *    its Discord (`discord_activity`, editor.mjs), which are checked
 *    post by post and refused, never warned.
 *
 * Pure: context in, request out; answer in, values out.
 */

import { MAX_POINTS, PITCH_FIELDS, validatePitch } from "./recruit.mjs";
import { GOALS, POSTURES } from "./goals.mjs";
import { CHAT_MAX, chatSafe, chatWarnings, clipChat } from "./chat.mjs";
import { chatLines } from "./delivery.mjs";
import { inGameCopy, LEADER_MESSAGE } from "./render.mjs";
import {
  inventedNumbers,
  numbersOf,
  strictTool,
  unknownNames,
} from "./context.mjs";

/** What a clan's model may write. */
export const PURPOSES = {
  recruit_pitch: {
    label: "Recruiting pitch",
    why: "Drafts the clan's recruiting words for a leader to edit and save.",
  },
  leader_message: {
    label: "Leader Message",
    why: "Drafts a Clan Leader Message in the clan's own voice (a promotion, a demotion, the season's awards, how the clan runs) for a leader to edit and send.",
  },
  clan_chat: {
    label: "Clan chat",
    why: "Drafts a welcome or a message after a leader's decision, for a person to edit and send in the game.",
  },
  // The one use whose words are sent unread (Jamie, 2026-10-10): the
  // editor of the clan's activity channel in its Discord, in the
  // leaders' voice from the record (Jamie, 2026-10-11: an editor that may
  // look things up, skip and merge; editor.mjs, context.mjs).
  discord_activity: {
    label: "Discord activity",
    why: "Edits the clan's activity channel in its Discord in the voice its leaders describe: it reads Elixir's stories and may look up a member's record, battles and the channel's recent posts, then tells each story, tells a few together or skips one with a reason; a post the checks refuse keeps Elixir's own words.",
  },
};

/**
 * The model each use runs on: Elixir Clan's choice, made for how the
 * product should work, never the leaders' (Jamie, 2026-10-11: "The model
 * is our selection based on how the product should work. The key and its
 * budget are the external decisions."). Each purpose lists the 5.5
 * generation in order; a use takes the first one the clan's key reaches
 * (`modelFor`), and refuses rather than fall back to an older generation.
 *
 * The leaders' drafts are read and edited before anything is sent and
 * are few, so they get the strongest writer. The Discord activity
 * editor's posts are sent unread, are many and are checked post by post,
 * so they start one step down. Change the mapping here and nowhere else.
 */
export const MODEL_FOR = {
  recruit_pitch: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  leader_message: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  clan_chat: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  discord_activity: [
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-haiku-5-5",
  ],
};

/**
 * The model a use of `purpose` runs on: the first of its `MODEL_FOR` list
 * that the key reaches. `ids` is the key's model list as last read. With
 * no list at all (null: never read) the first is taken and Anthropic's
 * answer decides; an empty list is known and reaches nothing (a 404 can
 * empty it), so it is null, as is a purpose with no models.
 */
export function modelFor(purpose, ids = null) {
  const wanted = MODEL_FOR[purpose] ?? [];
  if (ids == null) return wanted[0] ?? null;
  const reach = new Set(ids);
  return wanted.find((id) => reach.has(id)) ?? null;
}

/** A model's name for people: `claude-opus-5-5` reads "Claude Opus 5.5". */
export function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{8})?$/.exec(
    String(id ?? ""),
  );
  if (!m) return String(id ?? "");
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return `Claude ${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** A leader's note to the model is short. */
export const NOTE_MAX = 300;

/** The tones a chat draft may take, a leader's choice. A welcome or a
 *  farewell may add the leader's note too; the words after a removal take
 *  only the tone. */
export const CHAT_TONES = {
  warm: "Warm and brief",
  gentle: "Gentle and respectful",
  direct: "Plain and direct",
};

const TYPE = { open: "open", inviteOnly: "invite only", closed: "closed" };
const n = (x) => Number(x).toLocaleString("en-US");

/** The game's facts about the clan as lines, never a member. */
function factLines(facts) {
  if (!facts) return [];
  const out = [];
  if (facts.type) out.push(`Joining: ${TYPE[facts.type] ?? facts.type}.`);
  if (facts.members != null)
    out.push(
      `Members: ${facts.members} of 50${facts.open_slots != null ? ` (${facts.open_slots} places open)` : ""}.`,
    );
  if (facts.required_trophies != null)
    out.push(`Required trophies to join: ${n(facts.required_trophies)}.`);
  if (facts.clan_score != null) out.push(`Clan score: ${n(facts.clan_score)}.`);
  if (facts.war_trophies != null)
    out.push(`Clan war trophies: ${n(facts.war_trophies)}.`);
  if (facts.donations_per_week != null)
    out.push(`Donations a week: ${n(facts.donations_per_week)}.`);
  if (facts.location) out.push(`Location: ${facts.location}.`);
  if (facts.description)
    out.push(`The clan's in-game description: "${facts.description}"`);
  return out;
}

const PITCH_TOOL = {
  name: "write_pitch",
  description:
    "The clan's recruiting pitch, for its leaders to edit before anything is posted.",
  input_schema: {
    type: "object",
    properties: {
      tagline: {
        type: "string",
        description: `What the clan is in about six words (at most ${PITCH_FIELDS.tagline.max} characters). No clan name, no numbers.`,
      },
      about: {
        type: "string",
        description: `Two or three plain sentences a member could say out loud (at most ${PITCH_FIELDS.about.max} characters). No statistics.`,
      },
      points: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_POINTS,
        description: `Up to ${MAX_POINTS} short points (each at most ${PITCH_FIELDS.points.max} characters) on what makes the clan different, from what you were told only.`,
      },
      looking_for: {
        type: "string",
        description: `One sentence on the player who will be happy here (at most ${PITCH_FIELDS.looking_for.max} characters).`,
      },
    },
    required: ["tagline", "about", "points", "looking_for"],
  },
};

const PITCH_SYSTEM = [
  "You draft recruiting words for a Clash Royale clan, in its leaders' voice: plain, warm and specific, the way a player would say it. A leader edits your draft before anything is posted.",
  "Rules:",
  "- Use only what you are told about the clan. Never invent a number, a tradition, a reward, an event, a schedule or a rule. When you know little, write less.",
  "- Keep statistics out of the words: the clan's numbers (trophies, required trophies, members, war trophies, donations) are added to every post from the game.",
  "- Never name a member. No links, emoji, hashtags, markdown or backticks.",
  "- Keep to the limits in the tool's fields.",
  "- Write in English unless the leader's note asks for another language.",
  "Answer by calling write_pitch.",
].join("\n");

/**
 * The request for a recruiting pitch: the system words, the prompt, the
 * answer's shape, and the output budget. `howItWorks` is the policy as
 * members read it (`describePolicy`), `pitch` the clan's current words
 * (null for a first pitch), `note` what the leader asks for.
 */
export function pitchRequest({
  clanName = null,
  facts = null,
  goals = [],
  posture = null,
  howItWorks = [],
  pitch = null,
  note = null,
} = {}) {
  const lines = [
    `The clan: ${clanName ?? facts?.name ?? "a Clash Royale clan"}.`,
  ];
  const game = factLines(facts);
  if (game.length) lines.push("", "What the game says about it:", ...game);
  if (goals.length)
    lines.push(
      "",
      "What the clan is for, in its leaders' words:",
      ...goals.map(
        (g) => `- ${GOALS[g]?.label ?? g}: ${GOALS[g]?.about ?? ""}`,
      ),
    );
  if (posture && POSTURES[posture])
    lines.push(`- How hard it asks: ${POSTURES[posture].about}`);
  const rules = howItWorks.flatMap((s) => s.lines ?? []);
  if (rules.length)
    lines.push(
      "",
      "How it runs (its saved policy):",
      ...rules.map((l) => `- ${l}`),
    );
  if (pitch && (pitch.tagline || pitch.about))
    lines.push(
      "",
      "Its current pitch (improve it; keep what is true):",
      `Tagline: ${pitch.tagline ?? ""}`,
      `About: ${pitch.about ?? ""}`,
      ...(pitch.points ?? []).map((p) => `Point: ${p}`),
      `Looking for: ${pitch.looking_for ?? ""}`,
    );
  const ask = String(note ?? "")
    .trim()
    .slice(0, NOTE_MAX);
  if (ask) lines.push("", `The leader's note: ${ask}`);
  return {
    purpose: "recruit_pitch",
    // The tool's fields allow about 1,400 characters. Haiku 5.5 counts
    // about 30% more tokens than Haiku 4.5 for the same text, and a pitch
    // in another language takes more again, so 1200 could cut a full
    // answer off; a cut-off answer is refused, never a draft.
    max_tokens: 1600,
    effort: DRAFT_EFFORT,
    system: PITCH_SYSTEM,
    prompt: lines.join("\n"),
    tool: strictTool(PITCH_TOOL),
  };
}

const tidy = (v) =>
  String(v ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[`*_#]+/g, "")
    .replace(/^\s*[-•]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

const numbersIn = (text) =>
  String(text ?? "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .match(/\b\d+(?:\.\d+)?\b/g) ?? [];

/**
 * A model's answer as a pitch a leader can edit: tidied (no links,
 * markdown or bullets), clipped to each field's limit at a sentence, the
 * clan's own website and contact kept (a model never writes those), then
 * validated. `checks` are what a leader should look at before saving: a
 * number the model was not given (`prompt` is the request it answered).
 */
export function pitchFromDraft(input, current = null, { prompt = "" } = {}) {
  const a = input && typeof input === "object" ? input : {};
  const points = (Array.isArray(a.points) ? a.points : [])
    .map(tidy)
    .filter(Boolean)
    .slice(0, MAX_POINTS)
    .map((p) => clipChat(p, PITCH_FIELDS.points.max));
  const draft = {
    tagline: clipChat(tidy(a.tagline), PITCH_FIELDS.tagline.max),
    about: clipChat(tidy(a.about), PITCH_FIELDS.about.max),
    points,
    looking_for: clipChat(tidy(a.looking_for), PITCH_FIELDS.looking_for.max),
    website_url: current?.website_url ?? "",
    contact: current?.contact ?? "",
  };
  const known = new Set(numbersIn(prompt));
  const numbers = [
    ...new Set(
      numbersIn(
        [draft.tagline, draft.about, ...draft.points, draft.looking_for].join(
          " ",
        ),
      ).filter((x) => !known.has(x)),
    ),
  ];
  const checked = validatePitch(draft);
  return {
    values: draft,
    errors: checked.errors,
    checks: numbers.length
      ? [
          `Check before saving: ${numbers.map((x) => Number(x).toLocaleString("en-US")).join(", ")} ${numbers.length === 1 ? "was" : "were"} not in anything the model was told about the clan.`,
        ]
      : [],
  };
}

// ---------------------------------------------------------------- Drafts for an Action

/** How hard the model thinks for a leader's draft (Claude's `effort`):
 *  the leaders read every draft, so a careful one; `medium` is also
 *  Opus 5.5's own default, set here so a model change never changes it. */
export const DRAFT_EFFORT = "medium";

/**
 * The message length a Leader Message draft is asked for. The game takes
 * about 180 characters, a figure found by typing in the game and never
 * read from a spec (cr-agent-api-docs, `wiki-api-crosswalk.md`), so the
 * model is asked for 30 fewer and the answer is clipped to
 * `LEADER_MESSAGE.body`. Raise it only when the game's limit is
 * confirmed.
 */
const MESSAGE_ROOM = LEADER_MESSAGE.body - 30;

const MESSAGE_TOOL = {
  name: "write_leader_message",
  description:
    "A title and a message for a leader to edit, then send in the game.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: `At most ${LEADER_MESSAGE.title} characters.`,
      },
      body: {
        type: "string",
        description: `At most ${MESSAGE_ROOM} characters, placeholders included.`,
      },
    },
    required: ["title", "body"],
  },
};

/**
 * How the clan's model writes for the leaders. Jamie, 2026-10-11: the
 * clan's voice "removes all context and makes it generic dribble"; and
 * 2026-10-20: a draft should "use the full data resources of Elixir to
 * create a meaningfully more in-depth and personalized message". So
 * Elixir's plain words are the floor and the draft goes further, with
 * facts of the member's own; what is never said (a score or rank, fame
 * per member, advice, what the chat filter blanks) stays as it was.
 */
const writing = ({ note }) => [
  "You write for a Clash Royale clan, in its own voice. A leader reads and edits every draft before anyone sees it.",
  "After these instructions comes what Elixir knows: THE CLAN, then the moment (WHAT HAPPENED) and the member it is about. Every fact there comes from Elixir's record of the game. Use it.",
  "ELIXIR'S PLAIN WORDS are what Elixir sends when nobody drafts. They are the floor: say at least what they say, every number in them included, then go further.",
  "Use two to four facts that belong to this person: a best they reached, a war week they carried, how long they have been here, an award they hold, a moment from their record. Say what a number means, not only the number, and give each fact its own sentence.",
  'Sound like a person in the clan talking to friends: warm, plain and specific. Cut anything that would fit any member of any clan. Never write filler such as "by clan rules", "better with you in it", "keep climbing with us", or "earned it" without the fact that earned it.',
  note
    ? "Every name, number and event you write comes from those facts or from the leader's note. When something is not there, leave it out; never guess and never round a number up."
    : "Every name, number and event you write comes from those facts. When something is not there, leave it out; never guess and never round a number up.",
  "Never judge a member: no score, rank, percentile or standing, never a member's share of fame (war points are points, never fame), and no advice on how to play.",
  "The game's chat filter blanks some innocent text, so: write 'and', never '&'; never put '+' before a number; never join two words with a hyphen; never write 'phone'; no links, emoji, hashtags, markdown or @mentions.",
  note
    ? "Write in English unless the leader's note asks for another language."
    : "Write in English.",
];

/** Where a title-and-message draft goes, said to the model: the Inbox, or
 *  clan chat, where Elixir sends the two as one line or two. */
const DESTINATION = {
  leader_message:
    "You draft a Clan Leader Message: the title-and-message mail a leader sends to every member's in-game Inbox.",
  clan_chat:
    "You draft a heading and a message a leader posts in the game's clan chat. Elixir sends them as one chat line, or as two lines when they do not fit in one.",
};

const messageSystem = (destination) =>
  [
    DESTINATION[destination],
    ...writing({ note: true }),
    `Keep the title to ${LEADER_MESSAGE.title} characters and the message to ${MESSAGE_ROOM}.`,
    "Write the member's name as it is given. For a season's awards write {winners} where the list of awards and winners goes: Elixir puts the complete list there, so never write the list yourself; the words around it may name a winner and their number.",
    "Answer by calling write_leader_message.",
  ].join("\n");

const MESSAGE_KINDS = ["promotion", "demotion", "awards", "rules"];

/** What each draft is for. A demotion never says why (Jamie, 2026-10-20):
 *  it thanks the member for what came before. */
const ASK = {
  promotion:
    "Tell the clan this member is now an Elder, and thank them for what made it, from their own record.",
  demotion:
    "Tell the clan this Elder moves back to Member for now and that Elder can come back. Thank them for good history from their record (their time in the clan, an award they hold). Never shame them, and never say or hint why: nothing about lately, being quiet, missing or inactivity, and no number from recent weeks.",
  awards:
    "Announce the season's awards. Keep the words around {winners} short; a line on one winner's number is welcome.",
  rules:
    "Tell the clan how it runs now, in plain words members will read in the game. Say what changed, not the whole policy.",
  welcome:
    "Welcome this member. Make them feel seen with true details about them (their career wins, a best, their arena, their collection), and make no promises or demands.",
  returning:
    "Welcome this member back: the record shows an earlier time in this clan. Add true details about them, and make no promises or demands.",
  member_left:
    "A leader confirmed this member left on their own. Write a friendly farewell: thank them for specific things they gave the clan and wish them well. Never invent why they left.",
  member_kicked:
    "A leader confirmed this member was removed. Write brief, respectful words: thank them for their time and what they gave, without blame and without a reason. Never describe it as a voluntary leave, never mention inactivity, and promise nothing about returning.",
  removal:
    "Prepare one kind line to use only AFTER a leader decides to remove this member for inactivity and does it. Thank them for their time, and say they are welcome back when they are playing again. Never mention numbers about their inactivity, never shame, never give or invent a reason, and never advise whether to remove them.",
};

/** Elixir's plain words as lines: a chat draft's lines, or a title and a
 *  message. */
const plainLines = (plain) =>
  Array.isArray(plain?.lines)
    ? plain.lines.map((l) => String(l ?? "").trim()).filter(Boolean)
    : [
        ...(plain?.title ? [`Title: ${plain.title}`] : []),
        ...(plain?.body ? [`Message: ${plain.body}`] : []),
      ];

/**
 * The prompt every draft for an Action shares: the moment and its people
 * (the packet), Elixir's plain words as the floor, the leader's note as
 * written, and the ask.
 */
function draftPrompt({ packet, ask, plain = null, note = null }) {
  const lines = [String(packet ?? "").trim()];
  const words = plainLines(plain);
  if (words.length)
    lines.push(
      "",
      "ELIXIR'S PLAIN WORDS (the floor: say at least this, then go further)",
      ...words,
    );
  const said = String(note ?? "")
    .trim()
    .slice(0, NOTE_MAX);
  if (said)
    lines.push(
      "",
      `THE LEADER'S NOTE (follow it; it may add facts of its own): ${said}`,
    );
  lines.push("", `THE ASK: ${ask}`);
  return lines.join("\n").trim();
}

/**
 * The request for a title and a message in the clan's voice: a Clan
 * Leader Message, or an announcement's heading and message for clan chat
 * (`destination`). `context` is the clan (`clanContext`), the prefix
 * every request of the clan shares; `packet` the moment and its member
 * (`actionLines`, `memberLines`); `plain` the words the Action would send
 * with no draft; `note` the leader's words, as written.
 */
export function leaderMessageRequest({
  kind,
  context = "",
  packet = "",
  plain = null,
  note = null,
  destination = "leader_message",
} = {}) {
  if (!MESSAGE_KINDS.includes(kind))
    throw new Error(`no Leader Message for ${kind}`);
  if (!Object.hasOwn(DESTINATION, destination))
    throw new Error(`no destination ${destination}`);
  return {
    purpose: "leader_message",
    effort: DRAFT_EFFORT,
    max_tokens: 400,
    system: messageSystem(destination),
    context: String(context ?? ""),
    prompt: draftPrompt({ packet, ask: ASK[kind], plain, note }),
    tool: strictTool(MESSAGE_TOOL),
  };
}

/** What a leader should check in a draft: a number or a name the model
 *  was not given (`told`: everything the request carried). */
function toldChecks(text, told) {
  if (told == null) return [];
  const out = [];
  const numbers = inventedNumbers(text, told);
  if (numbers.length)
    out.push(
      `${numbers.map((x) => x.toLocaleString("en-US")).join(", ")} ${numbers.length === 1 ? "is" : "are"} not in anything Elixir told the model: check ${numbers.length === 1 ? "it" : "them"} before sending`,
    );
  const names = unknownNames(text, told);
  if (names.length)
    out.push(
      `${names.join(", ")} ${names.length === 1 ? "is" : "are"} not a name Elixir told the model: check before sending`,
    );
  return out;
}

/** The numbers Elixir's plain words state, each with whether it is a
 *  floor ("3,000+ career wins"). A share ("100%") is left out: a draft
 *  may say it in words. */
function plainNumbers(text) {
  const t = String(text ?? "").replace(/(\d),(?=\d{3}\b)/g, "$1");
  return [...t.matchAll(/(\d+(?:\.\d+)?)([+%])?/g)]
    .filter((m) => m[2] !== "%")
    .map((m) => ({ value: Number(m[1]), atLeast: m[2] === "+" }));
}

/** A demotion's words that hint at why (Jamie, 2026-10-20: a demotion
 *  thanks the member and never uses the recent window's numbers). */
const WHY =
  /\b(?:lately|recently|recent weeks?|quiet(?:er)?|miss(?:ed|ing)|inactiv(?:e|ity)|absen(?:t|ce)|dropped|slipped|fell short|less active|been away|busy)\b/i;

/**
 * The checks a draft for an Action gets beyond the told ones, warnings a
 * leader reads and never a refusal: a number Elixir's plain words state
 * that the draft leaves out (the plain words are the floor), and a
 * demotion that hints at why.
 */
function draftChecks(text, { kind, plain = null }) {
  const out = [];
  if (kind !== "awards") {
    const said = numbersOf(text);
    const missing = [
      ...new Set(
        plainNumbers(plainLines(plain).join("\n"))
          .filter(({ value, atLeast }) =>
            atLeast
              ? !said.some((x) => x >= value)
              : !said.some((x) => x === value),
          )
          .map(({ value, atLeast }) => `${n(value)}${atLeast ? "+" : ""}`),
      ),
    ];
    if (missing.length)
      out.push(
        `This draft says less of the record than Elixir's plain words: it leaves out ${missing.join(", ")}`,
      );
  }
  const why = kind === "demotion" ? WHY.exec(text) : null;
  if (why)
    out.push(
      `This demotion draft hints at why ("${why[0]}"): a demotion thanks them and never says why`,
    );
  return out;
}

/**
 * A model's title and message, made safe to send: the awards list put
 * in where the model left {winners} (or added when it left it out), a
 * promotion's or demotion's member named when the model did not, the
 * game's chat filter rules applied, and each part clipped to the game's
 * limits. `warnings` are what a leader should still look at: a score or
 * rank, text the filter would blank, a number or name the model was not
 * given (`told`: the request's context and prompt), a number of the
 * plain words (`plain`) the draft leaves out, and a demotion that hints
 * at why.
 */
export function leaderMessageFromDraft(
  input,
  { kind, name = null, awards = [], told = null, plain = null } = {},
) {
  const a = input && typeof input === "object" ? input : {};
  const who = chatSafe(name ?? "a member");
  const put = (text) => String(text ?? "").replaceAll("{name}", who);
  let title = put(a.title).replaceAll("{winners}", "").trim();
  let body = put(a.body);
  if (
    (kind === "promotion" || kind === "demotion") &&
    !chatSafe(body).includes(who)
  )
    body = `${who}: ${body}`;
  if (kind === "awards") {
    const winners = awards
      .map(
        (x) =>
          `${chatSafe(x.name)}: ${(x.winners ?? []).map(chatSafe).join(", ")}`,
      )
      .join("; ");
    const complete = winners
      ? `${winners}${winners.length < LEADER_MESSAGE.body ? "." : ""}`
      : "";
    if (complete.length > LEADER_MESSAGE.body)
      throw new RangeError("Awards need separate announcement parts.");
    // Every recipient in this segment is mandatory. Decorative model prose
    // uses only the space left after the complete list Elixir writes.
    const prose = chatSafe(body.replaceAll("{winners}", "")).trim();
    const room = LEADER_MESSAGE.body - complete.length - (complete ? 1 : 0);
    const intro = room >= 4 ? clipChat(prose, room) : "";
    body = [intro, complete].filter(Boolean).join(" ");
  }
  body = body.replaceAll("{winners}", "").replaceAll("{name}", who);
  title = clipChat(chatSafe(title), LEADER_MESSAGE.title);
  body = clipChat(chatSafe(body), LEADER_MESSAGE.body);
  const text = `${title}. ${body}`;
  return {
    title,
    body,
    warnings: [
      ...chatWarnings(title, LEADER_MESSAGE.title),
      ...chatWarnings(body, LEADER_MESSAGE.body),
      ...toldChecks(text, told),
      ...draftChecks(text, { kind, plain }),
    ],
  };
}

/** Project only the typed detail already approved for a welcome. Never
 * forward free-form fact text or extras from the action/profile. Profile
 * freshness was checked when the action froze this detail; its timestamp
 * remains provenance, not a claim that the value is current at draft time. */
const observationStamp = (value) => {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

function frozenWelcome(welcome) {
  const source_as_of = observationStamp(welcome?.source_as_of);
  if (welcome?.returning === true) return { returning: true, source_as_of };
  if (!source_as_of || !Number.isSafeInteger(welcome?.value)) return null;
  const value = welcome.value;
  let fact;
  if (welcome.kind === "career_wins" && value >= 1000)
    fact = `${(Math.floor(value / 1000) * 1000).toLocaleString("en-US")}+ career wins.`;
  else if (welcome.kind === "best_trophies" && value > 0)
    fact = `Recorded best: ${value.toLocaleString("en-US")} trophies.`;
  return fact ? { fact, source_as_of } : null;
}

function frozenDeparture(departure) {
  const confirmed_at = observationStamp(departure?.confirmed_at);
  if (
    !confirmed_at ||
    !["member_kicked", "member_left"].includes(departure?.classification)
  )
    return null;
  return {
    classification: departure.classification,
    confirmed_at,
    observed_left_at: observationStamp(departure.observed_left_at),
    tenure_days:
      Number.isSafeInteger(departure.tenure_days) && departure.tenure_days > 0
        ? departure.tenure_days
        : null,
  };
}

/**
 * How many clan-chat lines a draft may run to (Jamie, 2026-10-20): three
 * for a promotion; two for a welcome, a demotion or a farewell; one for
 * the words after a removal, which stay as they were. Each line is its
 * own send in the game's chat.
 */
export const CHAT_LINES = {
  promotion: 3,
  welcome: 2,
  demotion: 2,
  departure: 2,
  removal: 1,
};

/** The chat drafts that take only a tone, never the leader's note: the
 *  words after a removal. */
const TONE_ONLY = new Set(["removal"]);

/** The length a model is asked to keep a chat line to: under the game's
 *  200, so a leader's edit still fits; the removal line keeps its room. */
const lineRoom = (kind) => (kind === "removal" ? CHAT_MAX - 30 : CHAT_MAX - 10);

const chatSystem = (kind) => {
  const max = CHAT_LINES[kind];
  const room = lineRoom(kind);
  return [
    max === 1
      ? "You write one line for a Clash Royale clan's chat in the game. A person edits it and sends it; nothing is posted automatically."
      : `You write up to ${max} lines for a Clash Royale clan's chat in the game, each its own chat message, sent one after another. A person edits them and sends them; nothing is posted automatically.`,
    ...writing({ note: !TONE_ONLY.has(kind) }),
    max === 1
      ? `Keep it within ${room} characters, and write the member's name as it is given.`
      : `Keep each line within ${room} characters and make it read on its own: the first names the member, with their name as it is given, and says what happened; each further line carries a fact of its own. Write fewer lines when there is less that is true to say.`,
    "Answer by calling write_clan_chat.",
  ].join("\n");
};

/**
 * Clan-chat lines for an existing Action (2026-10-20): a promotion or a
 * demotion sent in chat, a welcome, a confirmed departure, or the words
 * for after a removal. `context` is the clan, `packet` the moment and the
 * member (a departure or a removal: their time in the clan and what they
 * gave; a demotion: their history, never the review's numbers), `plain`
 * the lines the Action would send with no draft, `note` the leader's
 * words (never for a removal) and `tone` their choice from `CHAT_TONES`.
 */
export function clanChatRequest({
  kind,
  context = "",
  packet = "",
  plain = null,
  note = null,
  tone = null,
  welcome = null,
  departure = null,
} = {}) {
  if (!Object.hasOwn(CHAT_LINES, kind))
    throw new Error(`no chat draft for ${kind}`);
  const confirmed = kind === "departure" ? frozenDeparture(departure) : null;
  if (kind === "departure" && !confirmed)
    throw new Error("departure is not confirmed");
  if (tone && !Object.hasOwn(CHAT_TONES, tone))
    throw new Error("invalid chat tone");
  if (TONE_ONLY.has(kind) && String(note ?? "").trim())
    throw new Error(`a ${kind} draft takes a tone, never a note`);
  const max = CHAT_LINES[kind];
  const room = lineRoom(kind);
  const ask =
    kind === "welcome"
      ? ASK[welcome?.returning === true ? "returning" : "welcome"]
      : kind === "departure"
        ? ASK[confirmed.classification]
        : ASK[kind];
  return {
    purpose: "clan_chat",
    effort: DRAFT_EFFORT,
    // Three lines of 190 characters, with room to spare.
    max_tokens: 600,
    system: chatSystem(kind),
    context: String(context ?? ""),
    prompt: draftPrompt({
      packet,
      ask: `${ask}${tone ? ` Tone: ${CHAT_TONES[tone]}.` : ""}`,
      plain,
      note: TONE_ONLY.has(kind) ? null : note,
    }),
    tool: strictTool({
      name: "write_clan_chat",
      description:
        "Clan-chat lines for a person to review, edit and send in the game, each its own message, in order.",
      input_schema: {
        type: "object",
        properties: {
          lines: {
            type: "array",
            items: {
              type: "string",
              description: `One chat message, at most ${room} characters.`,
            },
            maxItems: max,
            description:
              max === 1
                ? "Exactly one line."
                : `One to ${max} lines; the first names the member.`,
          },
        },
        required: ["lines"],
      },
    }),
  };
}

/**
 * A model's chat lines, made safe to send: at most the kind's lines, the
 * member named in the first when the model did not (a stray {name} is
 * filled in), the game's chat filter rules applied and each line clipped
 * to the game's 200. An empty answer is the plain words. `warnings`: per
 * line, text the filter would blank; then a number or name the model was
 * not given (`told`), a number of the plain words the draft leaves out,
 * and a demotion that hints at why.
 */
export function clanChatFromDraft(
  input,
  {
    kind,
    name = null,
    plain = null,
    told = null,
    welcome = null,
    departure = null,
  } = {},
) {
  if (!Object.hasOwn(CHAT_LINES, kind))
    throw new Error(`no chat draft for ${kind}`);
  if (kind === "departure" && !frozenDeparture(departure))
    throw new Error("departure is not confirmed");
  const who = chatSafe(name ?? "a member");
  const fill = (line) =>
    clipChat(chatSafe(String(line ?? "").replaceAll("{name}", who)), CHAT_MAX);
  // A draft asked for before the lines tool (a line, or a title and a
  // message) and collected after it still reads.
  const given = Array.isArray(input?.lines)
    ? input.lines
    : typeof input?.line === "string"
      ? [input.line]
      : input?.title || input?.body
        ? chatLines({ title: input.title, body: input.body })
        : [];
  let lines = given.map(fill).filter(Boolean).slice(0, CHAT_LINES[kind]);
  if (!lines.length) {
    const words = Array.isArray(plain?.lines) ? plain.lines : [];
    lines = (
      words.length
        ? words
        : [
            kind === "welcome"
              ? inGameCopy("welcome", {
                  name: who,
                  welcome: frozenWelcome(welcome),
                })
              : inGameCopy(kind === "departure" ? "farewell" : kind, {
                  name: who,
                }),
          ]
    )
      .map(fill)
      .filter(Boolean)
      .slice(0, CHAT_LINES[kind]);
  } else if (!lines[0].includes(who)) lines[0] = fill(`${who}: ${lines[0]}`);
  const text = lines.join("\n");
  return {
    lines,
    warnings: [
      ...lines.flatMap((line, i) =>
        chatWarnings(line, CHAT_MAX).map((w) =>
          lines.length > 1 ? `line ${i + 1}: ${w}` : w,
        ),
      ),
      ...toldChecks(text, told),
      ...draftChecks(text, { kind, plain }),
    ],
  };
}
