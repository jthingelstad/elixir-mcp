/**
 * What the clan's own model is told (Jamie, 2026-10-11: "The intent is to
 * become even more contextual and pull in the variety of data elixir
 * has"). One builder for both of its uses: the leaders' reviewed drafts
 * (words.mjs) and the activity posts in the clan's Discord
 * (activity.mjs). Both receive the same labelled, verified facts from
 * Elixir's record:
 *
 *  - the clan (`clanContext`): its name, its own words and goals, its
 *    member count and its last finished war weeks (week and place). The
 *    same text for every request of a clan, in a stable order, so it is
 *    the prompt's cached prefix;
 *  - a member (`memberLines`): their name, trophies and best, arena,
 *    career wins, collection level, time in the clan (and an earlier
 *    stint), their recent war weeks (decks used and points: never a
 *    member's share of fame), their recent moments in the clan's
 *    timeline and the awards they hold here;
 *  - what happened: an Action's own evidence (`actionLines`) or a
 *    timeline item's facts (`itemLines`).
 *
 * What never enters a packet: another leader's note, a hold, a removal's
 * rationale or inactivity numbers, any private Clan state beyond the
 * Action's own evidence, fame per member, corpus statistics. Absence over
 * a guess: a fact the record does not hold is left out, never filled in.
 *
 * And the checks the answers get: a number or a proper name that is not
 * in the packet (`inventedNumbers`, `unknownNames`). A draft a leader
 * reads gets a warning; a Discord post nobody reads is refused.
 *
 * Pure: facts in, text out.
 */

import { GOALS } from "./goals.mjs";

const n = (x) => Number(x).toLocaleString("en-US");
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const plural = (k, word) => `${n(k)} ${word}${k === 1 ? "" : "s"}`;
const day = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : null);
/** One line of text: no line breaks a value could smuggle in. */
const one = (v, max = 160) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** "season 135 week 4" from a war week's keys (the week counted from 0). */
export const weekName = (w) =>
  `season ${w.season_id} week ${Number(w.section_index) + 1}${w.is_colosseum ? " (Colosseum)" : ""}`;

/**
 * The clan, as every request of this clan begins: stable for the same
 * clan and the same record, so it is cached. `facts` is the gatherer's
 * `clan` (members, war); `pitch` the clan's recruiting words; `voice` the
 * leaders' words for its Discord posts; `goals` the policy's declared
 * goals.
 */
export function clanContext({
  name = null,
  pitch = null,
  voice = null,
  goals = [],
  facts = null,
} = {}) {
  const lines = ["THE CLAN", `Name: ${one(name) || "a Clash Royale clan"}`];
  if (pitch?.tagline) lines.push(`Its tagline: ${one(pitch.tagline)}`);
  if (pitch?.about) lines.push(`In its own words: ${one(pitch.about, 600)}`);
  if (voice) lines.push(`How its leaders want it to sound: ${one(voice, 400)}`);
  if (goals.length)
    lines.push(
      `What it is for: ${goals.map((g) => GOALS[g]?.label ?? g).join(", ")}`,
    );
  if (isNum(facts?.members)) lines.push(`Members now: ${facts.members}`);
  const war = (facts?.war ?? []).filter((w) => isNum(w.rank));
  if (war.length)
    lines.push(
      `Recent war weeks: ${war
        .map(
          (w) =>
            `${weekName(w)}: place ${w.rank}${isNum(w.trophy_change) ? `, ${w.trophy_change > 0 ? "+" : ""}${w.trophy_change} war trophies` : ""}`,
        )
        .join("; ")}`,
    );
  return lines.join("\n");
}

/**
 * One member as the record knows them. `scope` is "full" (a welcome, a
 * promotion, a moment) or "contribution" (a departure or a removal:
 * time in the clan and what they gave, never their trophies or idle days).
 */
export function memberLines(m, { scope = "full", label = "MEMBER" } = {}) {
  if (!m) return [];
  const lines = [`${label}: ${one(m.name) || "a member"}`];
  if (scope === "full") {
    if (m.role) lines.push(`Role in the clan: ${ROLE[m.role] ?? m.role}`);
    if (isNum(m.trophies))
      lines.push(
        `Trophies: ${n(m.trophies)}${isNum(m.best_trophies) ? `; best ever ${n(m.best_trophies)}` : ""}`,
      );
    if (m.arena) lines.push(`Arena: ${one(m.arena)}`);
    if (isNum(m.career_wins)) lines.push(`Career wins: ${n(m.career_wins)}`);
    if (isNum(m.collection_level))
      lines.push(`Collection level: ${m.collection_level}`);
  }
  if (isNum(m.tenure_days) && m.joined_at)
    lines.push(
      m.baseline
        ? `Time in the clan: at least ${plural(m.tenure_days, "day")} (recorded since ${day(m.joined_at)}, when Elixir first read the clan; they may have joined earlier)`
        : `Time in the clan: ${plural(m.tenure_days, "day")} (joined ${day(m.joined_at)})`,
    );
  if (m.stints_before > 0)
    lines.push(
      `Earlier time in this clan: ${plural(m.stints_before, "earlier stint")}${m.last_left_at ? `, the last ending ${day(m.last_left_at)}` : ""}`,
    );
  const war = (m.war ?? []).filter(
    (w) => isNum(w.decks_used) || isNum(w.points),
  );
  if (war.length)
    lines.push(
      `War weeks (their decks used and points): ${war
        .map(
          (w) =>
            `${weekName(w)}: ${isNum(w.decks_used) ? plural(w.decks_used, "deck") : "decks unknown"}${isNum(w.points) ? `, ${n(w.points)} points` : ""}`,
        )
        .join("; ")}`,
    );
  if (scope === "full" && m.moments?.length)
    lines.push(
      `Their recent moments: ${m.moments
        .slice(0, 5)
        .map((x) => `${day(x.at) ?? ""} ${one(x.text, 220)}`.trim())
        .join(" | ")}`,
    );
  if (m.awards?.length)
    lines.push(
      `Awards they hold in this clan: ${m.awards
        .slice(0, 6)
        .map(
          (a) =>
            `${one(a.name, 60)} (season ${a.season_id}${isNum(a.value) ? `, ${n(a.value)} ${UNIT[a.unit] ?? a.unit ?? ""}`.trimEnd() : ""})`,
        )
        .join("; ")}`,
    );
  return lines;
}

const ROLE = {
  leader: "Leader",
  coLeader: "Co-leader",
  elder: "Elder",
  member: "Member",
};
const UNIT = {
  points: "points",
  donations: "donations",
  war_decks: "war decks",
};

/**
 * What happened, for an Action a leader drafts words for: the Action's
 * own evidence in a person's terms. `card` is the Action, `grants` the
 * award receipts an announcement names, `policyLines` the policy as
 * members read it (`describePolicy`, for how the clan runs).
 */
export function actionLines(
  kind,
  { card = null, grants = [], policyLines = [] } = {},
) {
  const ev = card?.evidence ?? {};
  const lines = ["WHAT HAPPENED"];
  if (kind === "promotion" || kind === "demotion") {
    lines.push(
      kind === "promotion"
        ? "The clan's own rules just made this member an Elder."
        : "By the clan's own rules this Elder moves back to Member for now; it can come back.",
    );
    const facts = (ev.facts ?? []).filter((f) => f?.label && f?.value);
    if (ev.phrase) lines.push(`In short: ${one(ev.phrase, 200)}`);
    if (facts.length)
      lines.push(
        "What the rules counted:",
        ...facts.map(
          (f) =>
            `- ${one(f.label, 40)}: ${one(f.value, 120)}${f.window ? ` (${one(f.window, 60)})` : ""}`,
        ),
      );
  } else if (kind === "awards") {
    lines.push(
      `Season ${ev.season_id ?? "?"} closed and the clan granted these awards:`,
    );
    const named = grants.length
      ? grants.map(
          (g) =>
            `- ${one(g.name ?? g.award_id, 60)}: ${one(g.player_name ?? g.player_tag, 40)}${isNum(g.metric_value) ? ` (${n(g.metric_value)} ${UNIT[g.metric_unit] ?? g.metric_unit ?? ""})`.replace(" )", ")") : ""}`,
        )
      : (ev.awards ?? []).map(
          (a) =>
            `- ${one(a.name, 60)}: ${(a.winners ?? []).map((w) => one(w, 40)).join(", ")}`,
        );
    lines.push(...named);
    if (isNum(ev.parts) && ev.parts > 1)
      lines.push(`This is announcement ${ev.part} of ${ev.parts}.`);
  } else if (kind === "rules") {
    lines.push(
      ev.version === 1
        ? "The clan now runs with Elixir Clan: members can sign in with Elixir to see how it works and where they stand."
        : `The clan changed how it runs: ${(ev.changes ?? []).map((c) => one(c, 80)).join(", ") || "some settings"}. Members can see how it works in Elixir Clan.`,
    );
    if (policyLines.length)
      lines.push(
        "How the clan runs now, as members read it:",
        ...policyLines.slice(0, 16).map((l) => `- ${one(l, 300)}`),
      );
  } else if (kind === "welcome") {
    lines.push(
      ev.welcome?.returning
        ? "A member came back: the record shows an earlier time in this clan."
        : "A new member joined the clan.",
    );
    if (ev.joined_at) lines.push(`Joined: ${day(ev.joined_at)}`);
  } else if (kind === "departure") {
    const c = card?.outcome?.classification;
    lines.push(
      c === "member_left"
        ? "A leader confirmed the member left the clan on their own."
        : "A leader confirmed the member was removed from the clan.",
    );
    if (ev.left_at) lines.push(`Departed: ${day(ev.left_at)}`);
  } else if (kind === "removal") {
    lines.push(
      "The leaders may remove this member for inactivity. These words are for clan chat only after a leader has done it.",
    );
  }
  return lines;
}

/** A timeline item's facts as labelled lines: nested values flattened to
 *  a path ("best_win.opponent.name: Jotaro"), never a tag, an id, an
 *  address or a time, at most five of a list, never fame per member. */
export function itemFactLines(facts, { max = 40 } = {}) {
  const out = [];
  const walk = (value, path, depth, inMembers) => {
    if (out.length >= max || value == null) return;
    const key = path.at(-1) ?? "";
    if (
      /(_tag|_id|^id|^tag|url|_at|^at|_ms)$/i.test(key) ||
      // Bookkeeping, not the moment: the attester's stamp and who sees it.
      ["evidence", "attested_by", "visibility"].includes(key)
    )
      return;
    if (inMembers && /fame/i.test(key)) return;
    if (Array.isArray(value)) {
      value
        .slice(0, 5)
        .forEach((v, i) =>
          walk(
            v,
            [...path, String(i + 1)],
            depth + 1,
            inMembers || key === "members",
          ),
        );
      return;
    }
    if (typeof value === "object") {
      if (depth >= 3) return;
      for (const [k, v] of Object.entries(value))
        walk(v, [...path, k], depth + 1, inMembers);
      return;
    }
    if (typeof value === "string" && value.length > 120) return;
    out.push(
      `${path.join(".")}: ${typeof value === "number" ? n(value) : one(value)}`,
    );
  };
  walk(facts ?? {}, [], 0, false);
  return out;
}

/** Every recorded name a timeline item's facts carry: a member's, a
 *  previous name, an opponent's, a rival clan's, a teammate's, an arena
 *  or a card. Strings under a key that ends in `name`, at any depth.
 *  `people`: only a player's or a clan's own name (`name`,
 *  `previous_name`), never an arena's, a league's or a card's. */
export function namesInFacts(facts, { people = false } = {}) {
  const out = new Set();
  // A thing's name (an arena's, a league's, a card's, a badge's) is not a
  // person's: it may be said, but need not be.
  const THING =
    /arena|league|card|badge|form|mode|deck|award|path|season|tier/i;
  const wanted = (key, parent) =>
    people
      ? (key === "name" || key === "previous_name") && !THING.test(parent)
      : /name$/i.test(key);
  const walk = (value, key, parent, depth) => {
    if (value == null || depth > 4) return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v, key, parent, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k, key, depth + 1);
      return;
    }
    if (typeof value === "string" && wanted(key, parent) && value.trim())
      out.add(value.trim());
  };
  walk(facts ?? {}, "", "", 0);
  return [...out];
}

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

/** The numbers in a text, thousands separators ignored: "10,040" is
 *  10040, "S135" holds 135, "100%" holds 100. */
export const numbersOf = (text) =>
  (
    String(text ?? "")
      .replace(/(\d),(?=\d{3}\b)/g, "$1")
      .match(/\d+(?:\.\d+)?/g) ?? []
  ).map(Number);

/** Numbers a text states that its packet does not hold. */
export function inventedNumbers(text, packet) {
  const known = new Set(numbersOf(packet));
  return [...new Set(numbersOf(text).filter((x) => !known.has(x)))];
}

/** Capitalised words any message may use without a packet naming them:
 *  the game's and Elixir's own vocabulary, greetings, days and months. */
const COMMON = new Set(
  `I A An The And But So Or If We Our Us You Your They Their He She His Her It Its This That These Those
  What Who When Where How Why Well Nice Huge Big Great Good Massive Awesome Amazing Congrats Congratulations
  Welcome Hello Hi Hey Thanks Thank Cheers GG GL LFG MVP OMG Wow Yes No Let Lets Keep Go Here There All Every
  Clan Clans Wars War River Race Boat Colosseum Season Seasons Week Weeks Day Days Elder Elders Member Members
  Leader Leaders Co Coleader Arena Arenas League Leagues Path Legends Trophy Trophies Road Ranked Ladder
  Champion Champions Ultimate Grand Royal Legendary Badge Badges Card Cards Evolution Evo Hero Heroes Deck Decks
  King Kings Tower Crown Crowns Elixir Discord Clash Royale Supercell
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday
  January February March April May June July August September October November December`.split(
    /\s+/,
  ),
);

/**
 * Proper names a text uses that its packet does not: a capitalised word
 * (not the first of a sentence) that appears nowhere in the packet, the
 * leader's note included, and is not the game's own vocabulary. A
 * renamed opponent ("Jotaro" written "Jotarro") or an invented one is
 * caught; a name written in lower case is not, which the exact-name
 * check covers for the names a line must keep.
 */
export function unknownNames(text, packet) {
  const known = String(packet ?? "").toLowerCase();
  const out = new Set();
  const sentences = String(text ?? "").split(/(?<=[.!?:;])\s+|\n+/);
  for (const s of sentences) {
    const words = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) ?? [];
    words.forEach((w, i) => {
      if (i === 0) return;
      if (!/^\p{Lu}/u.test(w)) return;
      const bare = w.replace(/['’]s$/u, "");
      if (COMMON.has(bare) || COMMON.has(bare.replace(/s$/, ""))) return;
      if (known.includes(bare.toLowerCase())) return;
      out.add(bare);
    });
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* The answer's shape                                                  */
/* ------------------------------------------------------------------ */

/** Keywords strict tool use does not take: a length or count limit is
 *  said in the field's description and checked here after the answer. */
const UNSTRICT = [
  "maxLength",
  "minLength",
  "maxItems",
  "minItems",
  "minimum",
  "maximum",
];

/**
 * A tool as a strict one (Claude's `strict: true`): the answer is
 * sampled to match its schema, so a field is never missing or of the
 * wrong type. Every object is closed (`additionalProperties: false`) and
 * requires all its fields; the limits strict mode does not take are left
 * to the descriptions and the engine's own checks.
 */
export function strictTool(tool) {
  const close = (schema) => {
    if (!schema || typeof schema !== "object") return schema;
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
      if (UNSTRICT.includes(k)) continue;
      if (k === "properties")
        out.properties = Object.fromEntries(
          Object.entries(v).map(([name, s]) => [name, close(s)]),
        );
      else if (k === "items") out.items = close(v);
      else out[k] = v;
    }
    if (out.type === "object") {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties ?? {});
    }
    return out;
  };
  return { ...tool, strict: true, input_schema: close(tool.input_schema) };
}
