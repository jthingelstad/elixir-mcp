/**
 * The real-tag ratchet (2026-11-12).
 *
 * Many Clash Royale players are minors, so no real player's name or tag
 * belongs in this public repository, except King Thing #20JJJ2CCRU and
 * POAP KINGS #J2RGCRVG. Captured payloads put several hundred real tags
 * into fixtures, bites and tests before that rule; replacing them waits on
 * the owner. Until then this guard stops the number growing: it counts, per
 * tracked file, the distinct tag-shaped strings that are not allowed, and
 * `docs/no-real-tags.test.mjs` fails when a file's count rises above
 * `docs/no-real-tags.baseline.json` or a new file has one.
 *
 * What counts as a tag (the alphabet is the repo's own CR_TAG_ALPHABET,
 * `0289PYLQGRJCUV`, case-insensitive, letter O folded to 0):
 *
 * 1. A bare token: `#` (or its URL form `%23`) then 3 to 10 alphabet
 *    characters, not glued to a word, an HTML entity (`&#...`) or a
 *    hyphenated name on either side. It counts only when it holds at
 *    least one letter outside hexadecimal (P Y L Q G R J U V, or an O):
 *    that one rule rules out every CSS colour (`#000`, `#2c2c2c`, all of
 *    whose alphabet letters are hex) and every issue or PR number (`#868`,
 *    digits only). Written all in lower case it must also hold a digit, so
 *    an anchor or a hashtag that happens to spell over the alphabet
 *    (`#url`, `#color`) is not a tag; real tags are written in capitals.
 * 2. A keyed value: a JSON or JS key named `tag`, `*_tag` or `*Tag`
 *    (`"player_tag": "..."`, `previous_player_tag`, `clanTag: '...'`) whose string value passes
 *    the repo's own `normalizeTag`, with or without its `#`. In that
 *    context the hex and lower-case exclusions do not apply: the key says
 *    it is a tag.
 *
 * Each match is normalized to canonical form (`#`, upper case, O as 0) and
 * counted once per file. The two named tags and every tag in
 * `docs/invented-tags.json` are allowed. The counts never carry a value:
 * the baseline holds paths and numbers only.
 *
 * Inventing a tag: the reference (`cr-agent-api-docs`) and this repo's
 * helpers state only the alphabet, not how tags encode a number, so no
 * shape is assumed safe. Write a tag over the alphabet that starts `#0`
 * (real tags are not seen to start with 0, but that is unconfirmed) and
 * add it to `docs/invented-tags.json`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeTag } from "@elixir-mcp/contracts";

export const NAMED_TAGS = Object.freeze(["#20JJJ2CCRU", "#J2RGCRVG"]);

/**
 * Migrations are sha256-pinned (`db/migrations.sha256`) and can never be
 * edited, so their counts are fixed here rather than ratcheted: they must
 * equal these exactly, and the baseline never lists them.
 */
export const PINNED_FILES = Object.freeze({
  "db/migrations/0208_membership_first_read_baseline.sql": 1,
  "db/migrations/0210_live_fetch_strays_delete.sql": 2,
});

/** Files never scanned: binaries, the lockfile, this guard's own records. */
const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".pdf",
  ".zip",
  ".gz",
]);
const SKIP_PATHS = new Set([
  "package-lock.json",
  "docs/no-real-tags.baseline.json",
  "docs/invented-tags.json",
]);

const ALPHABET = "0289PYLQGRJCUVO";
const BARE = new RegExp(
  `(?<![\\w&-])(?:#|%23)([${ALPHABET}]{3,10})(?![\\w-])`,
  "gi",
);
const KEYED =
  /["']?\b(tag|\w+_tag|[a-z]\w*Tag)\b["']?\s*:\s*["']([^"'\n]{3,16})["']/g;
const NON_HEX = /[PYLQGRJUVO]/i;

function canonical(raw) {
  try {
    return normalizeTag(raw);
  } catch {
    return null;
  }
}

/** Every distinct canonical tag in `text`, allowed or not. */
export function tagsIn(text) {
  const found = new Set();
  for (const match of text.matchAll(BARE)) {
    const body = match[1];
    if (!NON_HEX.test(body)) continue;
    if (body === body.toLowerCase() && !/[0-9]/.test(body)) continue;
    const tag = canonical(body);
    if (tag) found.add(tag);
  }
  for (const match of text.matchAll(KEYED)) {
    const tag = canonical(match[2]);
    if (tag) found.add(tag);
  }
  return found;
}

/** The set of tags that never count: the two named, then the invented. */
export function allowedTags(root) {
  const invented = JSON.parse(
    readFileSync(path.join(root, "docs/invented-tags.json"), "utf8"),
  );
  return new Set([...NAMED_TAGS, ...invented.tags.map((t) => normalizeTag(t))]);
}

/** How many distinct tags in `text` are not allowed. */
export function countIn(text, allowed) {
  let n = 0;
  for (const tag of tagsIn(text)) if (!allowed.has(tag)) n += 1;
  return n;
}

/** Tracked files the guard reads. */
function scannedFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter(Boolean)
    .filter(
      (f) =>
        !SKIP_PATHS.has(f) &&
        !SKIP_EXTENSIONS.has(path.extname(f).toLowerCase()),
    );
}

/** `{ path: count }` for every scanned file with a non-allowed tag. */
export function census(root) {
  const allowed = allowedTags(root);
  const counts = {};
  for (const file of scannedFiles(root)) {
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue; // tracked but absent in this checkout (a deletion not yet committed)
    }
    if (text.includes("\0")) continue;
    const n = countIn(text, allowed);
    if (n > 0) counts[file] = n;
  }
  return counts;
}

/**
 * Compare a census with the baseline. `rose` are files over their count
 * (or new); `fell` are files under it; `pinned` are pinned files off their
 * fixed count.
 */
export function compare(counts, baseline, pinned = PINNED_FILES) {
  const rose = [];
  const fell = [];
  const pinnedOff = [];
  for (const [file, want] of Object.entries(pinned)) {
    const have = counts[file] ?? 0;
    if (have !== want) pinnedOff.push({ file, have, want });
  }
  for (const [file, have] of Object.entries(counts)) {
    if (file in pinned) continue;
    const was = baseline[file] ?? 0;
    if (have > was) rose.push({ file, have, was });
  }
  for (const [file, was] of Object.entries(baseline)) {
    const have = counts[file] ?? 0;
    if (have < was) fell.push({ file, have, was });
  }
  return { rose, fell, pinned: pinnedOff };
}

/** The baseline lowered to `counts`, never raised, never given a new file. */
export function lowered(counts, baseline) {
  const next = {};
  for (const file of Object.keys(baseline).sort()) {
    const n = Math.min(baseline[file], counts[file] ?? 0);
    if (n > 0) next[file] = n;
  }
  return next;
}
