#!/usr/bin/env node
/**
 * Replace real Clash Royale tags and names in the repository with invented
 * ones (`lib/anonymize.mjs` says how; `lib/no-real-tags.mjs` is the guard).
 *
 *   node infra/scripts/anonymize-fixtures.mjs <path>...
 *       rewrite the tracked text files under each path: every tag the
 *       guard counts there, and every player or clan name and clan
 *       description captured in the reference commit's fixtures
 *   --tags-from <path>   replace only the tags found under this path
 *                        (repeatable), wherever they appear in <path>...
 *   --no-names           tags only
 *   --dry-run            count, write nothing
 *   --forget             delete the local salt and exit
 *
 * The mapping is derived from a random salt kept only in
 * ~/.cache/elixir-anonymize/salt (mode 0600, outside the repository), so
 * several pull requests can share one mapping. It is never written,
 * printed or committed: this prints file paths and counts only. Delete
 * the salt (`--forget`) when the last pull request that needs it merges.
 *
 * Every invented tag used is added to docs/invented-tags.json. Needs
 * `npm run build` first (it reads `normalizeTag` from contracts' dist).
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectNames,
  inventDescription,
  inventName,
  replaceNames,
  replaceTags,
  tagInventor,
} from "./lib/anonymize.mjs";
import { PINNED_FILES, allowedTags, tagsIn } from "./lib/no-real-tags.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
/** The commit the guard landed on: the real tags and names it saw. */
const REFERENCE = "a59e8850d7d17cc5c346b94150075b6e7a43d057";
const SALT_FILE = path.join(os.homedir(), ".cache/elixir-anonymize/salt");
const NEVER = new Set([
  "package-lock.json",
  "docs/no-real-tags.baseline.json",
  "docs/invented-tags.json",
  ...Object.keys(PINNED_FILES),
]);
const SKIP_EXT = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz)$/i;
/** The game's own words, never replaced inside free text. */
const GAME_WORDS = [
  "king",
  "leader",
  "co-leader",
  "elder",
  "member",
  "clan",
  "war",
  "battle",
  "trophy",
  "trophies",
  "arena",
  "legend",
  "champion",
  "master",
  "grand",
  "royal",
  "ultimate",
  "challenger",
  "elixir",
  "river",
  "race",
  "boat",
  "colosseum",
  "duel",
  "ladder",
  "tower",
  "princess",
  "crown",
  "deck",
];

function parseArgs(argv) {
  const opts = { paths: [], tagsFrom: [], names: true, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tags-from") opts.tagsFrom.push(argv[++i]);
    else if (a === "--no-names") opts.names = false;
    else if (a === "--dry-run") opts.dry = true;
    else if (a === "--forget") opts.forget = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts.paths.push(a);
  }
  return opts;
}

function salt() {
  if (existsSync(SALT_FILE)) {
    if ((statSync(SALT_FILE).mode & 0o077) !== 0)
      throw new Error(`${SALT_FILE} must be mode 0600`);
    return readFileSync(SALT_FILE, "utf8").trim();
  }
  mkdirSync(path.dirname(SALT_FILE), { recursive: true, mode: 0o700 });
  const value = randomBytes(32).toString("hex");
  writeFileSync(SALT_FILE, `${value}\n`, { mode: 0o600 });
  chmodSync(SALT_FILE, 0o600);
  console.log(`anonymize: made a new salt at ${SALT_FILE}`);
  return value;
}

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
}

function tracked(paths) {
  const out = git(["ls-files", "-z", "--", ...paths]);
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => !NEVER.has(f) && !SKIP_EXT.test(f));
}

function read(file) {
  try {
    const text = readFileSync(path.join(root, file), "utf8");
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}

/** Every real tag and captured name the reference commit holds. */
function reference(allowed, paths = []) {
  const files = git(["ls-tree", "-r", "--name-only", REFERENCE, "--", ...paths])
    .split("\n")
    .filter(Boolean)
    .filter((f) => !NEVER.has(f) && !SKIP_EXT.test(f));
  const seen = new Set();
  const found = {
    names: new Set(),
    descriptions: new Set(),
    vocabulary: new Set(),
  };
  const blobs = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: files.map((f) => `${REFERENCE}:${f}`).join("\n") + "\n",
    maxBuffer: 1024 * 1024 * 1024,
  });
  // "<sha> blob <size>\n<content>\n" per file, sizes in bytes.
  let at = 0;
  for (const file of files) {
    const nl = blobs.indexOf(10, at);
    const size = Number(
      blobs.subarray(at, nl).toString("latin1").split(" ")[2],
    );
    const body = blobs.subarray(nl + 1, nl + 1 + size).toString("utf8");
    at = nl + 1 + size + 1;
    if (body.includes("\0")) continue;
    for (const t of tagsIn(body)) if (!allowed.has(t)) seen.add(t);
    if (file.endsWith(".json") && /(^|\/)(fixtures|bites)\//.test(file)) {
      try {
        collectNames(JSON.parse(body), found);
      } catch {
        // not JSON after all
      }
    }
  }
  return { seen, ...found, files };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.forget) {
    rmSync(SALT_FILE, { force: true });
    console.log(`anonymize: ${SALT_FILE} deleted`);
    return;
  }
  if (opts.paths.length === 0) throw new Error("name the paths to rewrite");
  const key = salt();
  const allowed = allowedTags(root);
  const ref = reference(allowed);
  const files = tracked(opts.paths);

  // The tags to replace: those the reference commit held under
  // --tags-from (with their names only), or those in the files themselves.
  const known = new Set();
  const from = opts.tagsFrom.length ? reference(allowed, opts.tagsFrom) : null;
  if (from) for (const t of from.seen) known.add(t);
  else
    for (const file of files) {
      const text = read(file);
      if (text) for (const t of tagsIn(text)) if (!allowed.has(t)) known.add(t);
    }
  const seen = new Set([...ref.seen, ...known]);
  const inventor = tagInventor(key, seen);
  for (const t of [...known].sort()) inventor(t);
  const written = new Set();
  const invent = (t) => {
    const out = inventor(t);
    written.add(out);
    return out;
  };

  const names = new Map();
  if (opts.names) {
    const source = from ?? ref;
    for (const n of source.names) names.set(n, inventName(key, n));
    for (const d of source.descriptions)
      names.set(d, inventDescription(key, d));
  }
  const stop = new Set([...GAME_WORDS, ...(ref.vocabulary ?? [])]);
  try {
    const catalog = JSON.parse(
      readFileSync(path.join(root, "fixtures/cards/catalog.json"), "utf8"),
    );
    for (const c of catalog.items ?? catalog)
      if (c?.name) stop.add(String(c.name).toLowerCase());
  } catch {
    // no catalog: only the game words
  }

  let changed = 0;
  let tagCount = 0;
  let nameCount = 0;
  const renames = [];
  for (const file of files) {
    const text = read(file);
    if (text == null) continue;
    const t = replaceTags(text, known, invent);
    const isJson = file.endsWith(".json");
    // Names are replaced in captured data and tests only: product source
    // and docs name no real player, and their invented examples stay put.
    const nameable = /(^|\/)(test|e2e|fixtures|bites)\//.test(file);
    const n =
      names.size && nameable
        ? replaceNames(t.text, names, {
            json: isJson,
            stop,
            freeWords: isJson && /(^|\/)(fixtures|bites)\//.test(file),
          })
        : { text: t.text, count: 0 };
    const base = path.basename(file);
    const renamed = replaceTags(base, known, invent);
    if (renamed.count)
      renames.push([file, path.join(path.dirname(file), renamed.text)]);
    if (n.text === text) continue;
    changed += 1;
    tagCount += t.count;
    nameCount += n.count;
    if (!opts.dry) writeFileSync(path.join(root, file), n.text);
    console.log(`  ${file}: ${t.count} tags, ${n.count} names`);
  }
  for (const [from, to] of renames) {
    console.log(`  rename ${from} -> (invented)`);
    if (!opts.dry) git(["mv", from, to]);
  }

  // Every invented tag that now appears in the tree goes on the list.
  const listPath = path.join(root, "docs/invented-tags.json");
  const list = JSON.parse(readFileSync(listPath, "utf8"));
  const before = new Set(list.tags);
  const add = [...written].filter((t) => !before.has(t));
  if (!opts.dry && add.length) {
    list.tags = [...list.tags, ...add.sort()];
    writeFileSync(listPath, `${JSON.stringify(list, null, 2)}\n`);
  }
  console.log(
    `anonymize: ${files.length} files read, ${changed} changed, ${tagCount} tags and ${nameCount} names replaced, ${renames.length} renamed, ${add.length} invented tags listed${opts.dry ? " (dry run)" : ""}`,
  );
}

main();
