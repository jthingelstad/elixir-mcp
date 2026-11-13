/**
 * Replacing real Clash Royale tags and names with invented ones
 * (2026-11-13; the ratchet is `no-real-tags.mjs`, the CLI
 * `../anonymize-fixtures.mjs`).
 *
 * Many players are minors and this repository is public, so captured
 * payloads and the tests built on them must carry invented players and
 * clans. Everything here is a pure function of a secret salt and the real
 * value, so one player stays one invented player across every file and
 * every run that shares the salt, and the real-to-invented mapping exists
 * only in memory: it is never written, printed or committed.
 *
 * - **Tags** keep their length, start `#0`, use the tag alphabet, and are
 *   checked against every real tag seen and every tag already invented in
 *   the run (a clash takes the next candidate).
 * - **Names** keep their shape: spaces, punctuation and markup characters
 *   stay where they were; each run of Latin letters becomes a neutral word
 *   of about the same length and the same capitalisation (with an accent
 *   when the original had one); a run in another script becomes a neutral
 *   word in that script; digits become other digits; each emoji another
 *   emoji. So a test that relies on a long name, a non-ASCII name, an
 *   emoji or a name with `<`, `&` or a quote still meets one.
 * - **Clan descriptions** become a neutral sentence of about the same
 *   length.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { normalizeTag } from "@elixir-mcp/contracts";
import { NAMED_TAGS } from "./no-real-tags.mjs";

export const TAG_ALPHABET = "0289PYLQGRJCUV";
const WORDS = JSON.parse(
  readFileSync(new URL("./invented-words.json", import.meta.url), "utf8"),
);
const BY_LENGTH = new Map();
for (const w of WORDS.latin) {
  if (!BY_LENGTH.has(w.length)) BY_LENGTH.set(w.length, []);
  BY_LENGTH.get(w.length).push(w);
}
const MAX_WORD = Math.max(...BY_LENGTH.keys());

/** The names never replaced: the two players this repo may name. */
export const NAMED_NAMES = Object.freeze(["King Thing", "POAP KINGS"]);

/** A stream of deterministic bytes for (salt, purpose, value). */
function stream(salt, purpose, value) {
  let block = 0;
  let buf = Buffer.alloc(0);
  let at = 0;
  return () => {
    if (at >= buf.length) {
      buf = createHmac("sha256", salt)
        .update(`${purpose}\u0000${value}\u0000${block++}`)
        .digest();
      at = 0;
    }
    return buf[at++];
  };
}

function canonical(raw) {
  try {
    return normalizeTag(raw);
  } catch {
    return null;
  }
}

/**
 * A tag inventor for one run. `seen` is every real tag the run knows of
 * (canonical), which an invented tag must never equal. The same real tag
 * always gets the same invented tag from the same salt, unless a clash
 * forces the next candidate (vanishingly rare at captured lengths).
 */
export function tagInventor(salt, seen = new Set()) {
  const assigned = new Map();
  const used = new Set();
  return (tag) => {
    const real = canonical(tag);
    if (!real) throw new Error("not a tag");
    if (NAMED_TAGS.includes(real)) return real;
    if (assigned.has(real)) return assigned.get(real);
    const len = real.length - 1;
    for (let k = 0; ; k++) {
      const next = stream(salt, `tag:${k}`, real);
      let body = "0";
      while (body.length < len) body += TAG_ALPHABET[next() % 14];
      const out = `#${body}`;
      if (len >= 2 && body === "0".repeat(len)) continue;
      if (seen.has(out) || used.has(out) || NAMED_TAGS.includes(out)) continue;
      if (k > 10_000) throw new Error("no free invented tag of that length");
      assigned.set(real, out);
      used.add(out);
      return out;
    }
  };
}

const SCRIPTS = Object.keys(WORDS.scripts).filter((s) => s !== "other");
const SCRIPT_RE = Object.fromEntries(
  SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, "u")]),
);
const LATIN = /\p{Script=Latin}/u;
const EMOJI =
  /\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*|\p{Regional_Indicator}{2}/u;
const RUN = new RegExp(
  `(${EMOJI.source})|([\\p{L}\\p{M}\\p{N}]+)|([^\\p{L}\\p{M}\\p{N}])`,
  "gu",
);

function pick(next, list) {
  return list[next() % list.length];
}

/** A Latin word close to `len` characters (several joined for long runs). */
function latinWord(next, len) {
  let out = "";
  let left = Math.max(1, len);
  while (left > 0) {
    const want = Math.min(left, MAX_WORD);
    let n = want;
    while (n > 1 && !BY_LENGTH.has(n)) n -= 1;
    const list = BY_LENGTH.get(n) ?? BY_LENGTH.get(2);
    let w = pick(next, list);
    if (want === 1) w = w.slice(0, 1);
    out += out ? w[0].toUpperCase() + w.slice(1) : w;
    left -= w.length;
  }
  return out;
}

function caseLike(original, word) {
  const letters = original.replace(/[^\p{L}]/gu, "");
  if (letters && letters === letters.toUpperCase() && letters.length > 1)
    return word.toUpperCase();
  if (letters && letters === letters.toLowerCase()) return word.toLowerCase();
  return word[0].toUpperCase() + word.slice(1);
}

function accented(word) {
  const at = [...word].findIndex((c) => WORDS.accents[c.toLowerCase()]);
  const chars = [...word];
  if (at < 0) return `${word}ñ`;
  const c = chars[at];
  const a = WORDS.accents[c.toLowerCase()];
  chars[at] = c === c.toUpperCase() ? a.toUpperCase() : a;
  return chars.join("");
}

function inventRun(next, run) {
  if (/^\p{N}+$/u.test(run))
    return [...run].map(() => String(next() % 10)).join("");
  const script = SCRIPTS.find((s) => SCRIPT_RE[s].test(run));
  if (script) return caseLike(run, pick(next, WORDS.scripts[script]));
  const letters = [...run].filter((c) => /\p{L}/u.test(c));
  if (letters.length > 0 && !letters.every((c) => LATIN.test(c)))
    return pick(next, WORDS.scripts.other);
  const digits = (run.match(/\p{N}+$/u) ?? [""])[0];
  const head = run.slice(0, run.length - digits.length);
  const bareLen = [...head].length;
  let word = caseLike(head || run, latinWord(next, bareLen));
  if (/[^ -~]/.test(head)) word = accented(word);
  const tail = [...digits].map(() => String(next() % 10)).join("");
  return word + tail;
}

/** An invented name with the shape of `name`, the same for the same salt. */
export function inventName(salt, name) {
  if (NAMED_NAMES.includes(name)) return name;
  const next = stream(salt, "name", name);
  let out = "";
  for (const m of name.matchAll(RUN)) {
    if (m[1])
      out += /‍/.test(m[1]) ? WORDS.emoji_sequence : pick(next, WORDS.emoji);
    else if (m[2]) out += inventRun(next, m[2]);
    else out += m[3];
  }
  return out === name ? `${out}x` : out;
}

/** A neutral clan description about as long as `text`. */
export function inventDescription(salt, text) {
  if (!text.trim()) return text;
  const next = stream(salt, "description", text);
  const target = [...text].length;
  let out = pick(next, WORDS.description);
  while (out.length < target - 20) out += ` ${pick(next, WORDS.description)}`;
  if (out.length > target && target >= 8) out = out.slice(0, target).trimEnd();
  return out;
}

const KEY_TAG = /^(tag|\w+_tag|[a-z]\w*Tag)$/;
const KEY_NAME = /^(name|\w+_name|[a-z]\w*Name|nickname|\w+_nickname)$/;
const NOT_NAMES = new Set(["rawName", "file_name", "tool_name", "kind_name"]);

/**
 * Walk parsed JSON and collect the player and clan names and the clan
 * descriptions in it: a name-shaped key in an object that also carries a
 * tag-shaped key, and the strings of a `names` list. A name paired with
 * one of the two named tags (or one of their names) is left alone.
 */
const GAME_KEY = /^(arena|league|game_?mode|mode|archetype)(_?[nN]ame)?$/;

export function collectNames(
  value,
  out = { names: new Set(), descriptions: new Set() },
) {
  if (Array.isArray(value)) {
    for (const v of value) collectNames(v, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const keys = Object.keys(value);
  out.vocabulary ??= new Set();
  const tagKeys = keys.filter(
    (k) =>
      KEY_TAG.test(k) && typeof value[k] === "string" && canonical(value[k]),
  );
  // The game's own things (cards, badges, arenas, leagues): their names
  // are vocabulary, never replaced.
  const thing =
    typeof value.id === "number" ||
    "iconUrls" in value ||
    "maxLevel" in value ||
    "rawName" in value ||
    "progress" in value;
  if (tagKeys.length === 0 && thing)
    for (const k of keys)
      if (KEY_NAME.test(k) && typeof value[k] === "string")
        for (const w of [value[k], ...value[k].split(/\s+/)])
          if (w.trim()) out.vocabulary.add(w.trim().toLowerCase());
  if (tagKeys.length > 0) {
    for (const k of keys) {
      const v = value[k];
      if (typeof v !== "string" || !v || NOT_NAMES.has(k) || !KEY_NAME.test(k))
        continue;
      const prefix = k.replace(/(_?[nN]ame|_?nickname)$/, "");
      const pair =
        tagKeys.find((t) => t.replace(/_?[tT]ag$/, "") === prefix) ??
        (tagKeys.length === 1 ? tagKeys[0] : null);
      const pairedTag = pair ? canonical(value[pair]) : null;
      if (pairedTag && NAMED_TAGS.includes(pairedTag)) continue;
      if (NAMED_NAMES.includes(v)) continue;
      out.names.add(v);
    }
    if (typeof value.description === "string" && value.description.trim()) {
      const t = canonical(value.tag ?? value.clan_tag ?? "");
      if (!t || !NAMED_TAGS.includes(t))
        out.descriptions.add(value.description);
    }
  }
  for (const k of keys) {
    const v = value[k];
    // An arena, league or mode named in a string is the game's word too.
    if (GAME_KEY.test(k) && typeof v === "string" && v.trim())
      for (const w of [v, ...v.split(/\s+/)])
        if (w.trim()) out.vocabulary.add(w.trim().toLowerCase());
    if (/(^|_)names$/.test(k) && Array.isArray(v))
      for (const n of v) {
        if (typeof n === "string" && n && !NAMED_NAMES.includes(n))
          out.names.add(n);
        else if (
          n &&
          typeof n === "object" &&
          typeof n.name === "string" &&
          !NAMED_NAMES.includes(n.name)
        )
          out.names.add(n.name);
      }
    collectNames(v, out);
  }
  return out;
}

const NON_HEX = /[PYLQGRJUVO]/i;
const TOKEN = /(?<![0-9A-Za-z&])(#|%23)?([0-9A-Za-z]{3,12})(?![0-9A-Za-z])/g;

/**
 * Replace every tag `invent` knows in `text`. `known` is the set of real
 * canonical tags to replace; everything else is left alone. A tag is met
 * as `#BODY`, `%23BODY` or bare `BODY`, upper or lower case. A bare body
 * shorter than six characters, or one with no letter outside hex (which
 * could be a colour or a number), is replaced only as a whole quoted
 * string, the way a keyed value is written.
 *
 * With `{ bare: true }` (hand-written tests), a tag the same text writes
 * with its `#` is replaced in every form: with its `#` even when all hex,
 * and bare in a path, a query or a no-space list when upper case or holding a digit: a test builds `/home/player/BODY` or
 * `BODY,BODY` from the tags it declares, and both must move together.
 */
export function replaceTags(
  text,
  known,
  invent,
  { bare = false, declaredAll = false } = {},
) {
  let n = 0;
  // declaredAll: the run's tags are declared in sibling files of one suite.
  const declared = new Set(bare && declaredAll ? known : []);
  if (bare)
    for (const m of text.matchAll(TOKEN)) {
      if (!m[1]) continue;
      const real = canonical(m[2]);
      if (real && known.has(real)) declared.add(real);
    }
  const out = text.replace(TOKEN, (match, prefix, body, offset) => {
    const real = canonical(body);
    if (!real || !known.has(real)) return match;
    const quoted =
      /["'`]/.test(text[offset - 1] ?? "") &&
      text[offset - 1] === text[offset + match.length];
    const strong = body.length >= 6 && NON_HEX.test(body);
    // A path segment or a query, or a list joined with no space (code puts
    // a space after its commas, so an identifier never qualifies; a list
    // item needs a letter, so a thousands group never does).
    const before = text[offset - 1] ?? "";
    const after = text[offset + match.length] ?? "";
    const inPath =
      before === "/" ||
      ((after === "/" || after === "?") && /[A-Za-z]/.test(body));
    const inList =
      /[A-Za-z]/.test(body) &&
      ((before === "," && /[0-9A-Za-z]/.test(text[offset - 2] ?? "")) ||
        (after === "," &&
          /[0-9A-Za-z]/.test(text[offset + match.length + 1] ?? "")));
    const sibling =
      declared.has(real) &&
      (Boolean(prefix) ||
        ((inPath || inList) &&
          (body === body.toUpperCase() || /[0-9]/.test(body))));
    if (sibling) {
      const lower = body === body.toLowerCase() && /[a-z]/.test(body);
      let inv = invent(real).slice(1);
      if (lower) inv = inv.toLowerCase();
      n += 1;
      return `${prefix ?? ""}${inv}`;
    }
    if (!prefix && !strong && !quoted) return match;
    if (prefix && !NON_HEX.test(body) && !quoted) return match;
    if (!/[A-Za-z]/.test(body) && !quoted && !prefix) return match;
    const lower = body === body.toLowerCase() && /[a-z]/.test(body);
    let inv = invent(real).slice(1);
    if (lower) inv = inv.toLowerCase();
    n += 1;
    return `${prefix ?? ""}${inv}`;
  });
  return { text: out, count: n };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace names (and descriptions) in `text`. `map` is real to invented.
 * A value written as a whole quoted string is always replaced; inside
 * free text a name is replaced only when it is at least four characters
 * and not in `stop` (card names and the game's own words), at word
 * boundaries. `json` writes the JSON-escaped forms.
 */
export function replaceNames(
  text,
  map,
  { json = false, stop = new Set(), freeWords = false } = {},
) {
  let n = 0;
  const enc = (s) => (json ? JSON.stringify(s).slice(1, -1) : s);
  const entries = [...map].sort((a, b) => b[0].length - a[0].length);
  let out = text;
  const variants = [];
  for (const [real, fake] of entries) {
    // A name made only of the game's words and numbers ("Member 1") is
    // vocabulary, and the code makes such names itself.
    const words = real.trim().toLowerCase().split(/\s+/);
    if (words.every((w) => stop.has(w) || /^\d+$/.test(w))) continue;
    if (stop.has(real.trim().toLowerCase())) continue;
    variants.push([real, fake]);
    // A name of several words is also met lower-cased (a person typing
    // it) and upper-cased.
    if (/\s/.test(real.trim())) {
      variants.push([real.toLowerCase(), fake.toLowerCase()]);
      variants.push([real.toUpperCase(), fake.toUpperCase()]);
    }
  }
  for (const [real, fake] of variants) {
    const r = enc(real);
    if (!out.includes(r)) continue;
    const f = enc(fake);
    const q = new RegExp(`(["'\`])${escapeRe(r)}\\1`, "g");
    out = out.replace(q, (_m, quote) => {
      n += 1;
      return `${quote}${f}${quote}`;
    });
    const trimmed = real.trim();
    if (trimmed.length < 4 || trimmed !== real) continue;
    // A plain word (no space, digit, symbol or non-ASCII letter) may be an
    // ordinary word or an identifier in free text: only as a whole value.
    const plain = /^[A-Za-z]+$/.test(real);
    if (plain && (!freeWords || real === real.toLowerCase())) continue;
    const lead = /^[\p{L}\p{N}_]/u.test(r) ? "(?<![\\p{L}\\p{N}_])" : "";
    const tail = /[\p{L}\p{N}_]$/u.test(r) ? "(?![\\p{L}\\p{N}_])" : "";
    const free = new RegExp(`${lead}${escapeRe(r)}${tail}`, "gu");
    out = out.replace(free, () => {
      n += 1;
      return f;
    });
  }
  return { text: out, count: n };
}
