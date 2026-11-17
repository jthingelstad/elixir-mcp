/**
 * The cheap checks every comment passes before the model sees it
 * (2026-11-16): plain text tidied, its length, and the patterns a small
 * model need not be paid to catch (links, phone numbers, email
 * addresses, social handles and "add me on" asks). Each refusal names a
 * category from the same list the model answers with (comment-check.mjs),
 * so the author always sees one plain reason.
 *
 * Pure: no database, no model. The repeat check (the same words again)
 * needs the author's recent comments and lives with the writes
 * (comments.mjs).
 */

/** The most a comment may say, in characters (code points). */
export const COMMENT_MAX = 280;

/** The most a post may say (2026-11-17): a question needs more room
 *  than a reply. */
export const POST_MAX = 500;

/** Invisible and direction-changing characters: dropped, so a link or a
 *  number cannot hide between them and nobody's comment can flip the text
 *  around it. */
const INVISIBLE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b-\u001f\u007f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** A comment as it is stored: NFC, invisible characters gone, runs of
 *  blank lines and spaces collapsed, ends trimmed. */
export function tidyComment(raw) {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Folded for matching: lower case, accents off, common look-alike
 *  digits and symbols read as letters, separators gone. Never stored. */
export function foldForMatch(text) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[0@4]/g, (c) => (c === "0" ? "o" : "a"))
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t");
}

const TLDS =
  "com|net|org|io|gg|co|me|tv|ly|xyz|app|dev|link|site|online|info|biz|us|uk|ca|de|fr|es|br|ru|in|au|nl|pl|it|jp|kr|cn|tk|ml|ga|cf|gq|to|cc|ws|be|ch|se|no|fi|dk|mx|ar|cl|id|ph|vn|tr|gl|bit";

const LINK_PATTERNS = [
  /\bhttps?:\/\//i,
  /\bwww\s*[.,]\s*\S/i,
  new RegExp(`\\b[a-z0-9-]{2,}\\s*[.]\\s*(?:${TLDS})\\b`, "i"),
  // "site dot com", "site(dot)gg", "site [.] io"
  new RegExp(
    `\\b[a-z0-9-]{2,}\\s*(?:\\(|\\[|\\{)?\\s*(?:dot|punto|point|punkt)\\s*(?:\\)|\\]|\\})?\\s*(?:${TLDS})\\b`,
    "i",
  ),
  /\b(?:discord\.gg|discord\s*gg|bit\s*\.?\s*ly|t\.me|wa\.me)\b/i,
];

const EMAIL =
  /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\sdot\s)\s*[a-z]{2,}/i;

/** Seven or more digits, perhaps split by spaces, dots, dashes or
 *  brackets: a phone number. A score ("3-0", "6900 trophies") has fewer
 *  in a row. Spelled-out digits count too. */
const DIGIT_WORDS =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b/gi;
function looksLikePhone(text) {
  const runs = text.match(/[+(]?\d[\d\s().-]{5,}\d/g) ?? [];
  if (runs.some((r) => r.replace(/\D/g, "").length >= 7)) return true;
  const words = text.match(DIGIT_WORDS) ?? [];
  return words.length >= 7;
}

/** Apps people move a chat to, and the asks that go with them. */
const APPS =
  "snap|snapchat|insta|instagram|ig|tiktok|tik tok|discord|whatsapp|whats app|telegram|kik|wechat|facebook|fb|messenger|twitter|threads|roblox|xbox|psn|steam|skype|signal|youtube|twitch|reddit|venmo|cashapp|cash app|paypal|onlyfans";
const MOVE_ASKS = [
  new RegExp(
    `\\b(?:add|follow|dm|msg|message|text|hmu|hit me up|find|friend)\\s+(?:me\\s+)?(?:on|at|in|@)\\s+(?:${APPS})\\b`,
    "i",
  ),
  new RegExp(
    `\\b(?:whats|what's|what is|wats)\\s+(?:your|ur)\\s+(?:${APPS})\\b`,
    "i",
  ),
  new RegExp(`\\b(?:my|ur|your)\\s+(?:${APPS})\\s*(?::|=|is\\b|@|-)`, "i"),
  new RegExp(`\\b(?:${APPS})\\s*[:=]\\s*@?[a-z0-9_.]{3,}`, "i"),
  /\b(?:dm|pm|text)\s+me\b/i,
  /\b(?:my|ur|your)\s+(?:phone|cell|address|email|e-mail)\b/i,
];

/** "@name": a handle that would look like a mention. Comments mention
 *  nobody in v1, and a handle is often a way off Elixir. */
const HANDLE = /(?:^|[\s(])@[a-z0-9_.]{3,}/i;

/**
 * The cheap verdict on a tidied comment, or a post with `max` POST_MAX:
 * `{ ok: true }` or `{ ok: false, category }` with category one of empty,
 * too_long, link, personal_info.
 */
export function filterComment(text, { max = COMMENT_MAX } = {}) {
  if (!text) return { ok: false, category: "empty" };
  if ([...text].length > max) return { ok: false, category: "too_long" };
  const folded = foldForMatch(text);
  // An email address reads as a domain too; it is personal first.
  if (EMAIL.test(text)) return { ok: false, category: "personal_info" };
  if (LINK_PATTERNS.some((re) => re.test(text) || re.test(folded)))
    return { ok: false, category: "link" };
  if (looksLikePhone(text)) return { ok: false, category: "personal_info" };
  if (MOVE_ASKS.some((re) => re.test(text) || re.test(folded)))
    return { ok: false, category: "personal_info" };
  if (HANDLE.test(text)) return { ok: false, category: "personal_info" };
  return { ok: true };
}
