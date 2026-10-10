/**
 * npm run contract:bump -- <patch|minor|major>
 *
 * Writes the next contract version's file, src/changes/<version>.ts, with
 * a skeleton entry dated today (UTC). The next version is counted from the
 * highest one on origin/main, fetched first, never from this checkout:
 * another pull request may have taken a number since this branch began.
 *
 * Run it again when origin/main has overtaken this branch's version (the
 * pull request conflicts on the file, or a newer version merged): before
 * rebasing, it renumbers the version file this branch added to the next
 * free version (the kind given, else the kind the branch chose), updates
 * the entry's `version`, and rewrites "MCP <old>" in the fragments this
 * branch added (docs/notes/, apps/site/src/_data/updates/ and the version
 * file itself). It never touches a file the branch did not add. The JSON
 * API pin (services/web-api/test/integration-api.pin.json) records the
 * JSON API's own version, not the contract's, so it is left alone.
 *
 * It edits the working tree only and prints the paths to stage.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  bumpKind,
  bumpVersion,
  compareVersions,
  versionsIn,
  writeIndex,
} from "./changes-index.mjs";

const CHANGES = "packages/contracts/src/changes";
const FRAGMENTS = [
  `${CHANGES}/`,
  "docs/notes/",
  "apps/site/src/_data/updates/",
];
const KINDS = ["patch", "minor", "major"];

const die = (message) => {
  console.error(`contract:bump: ${message}`);
  process.exit(1);
};

const git = (root, ...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const lines = (text) => text.split("\n").filter(Boolean);

/** The versions in src/changes/ at a commit, newest first. */
function versionsAt(root, rev) {
  try {
    git(root, "rev-parse", "--verify", "--quiet", `${rev}:${CHANGES}`);
  } catch {
    return [];
  }
  return versionsIn(
    lines(git(root, "ls-tree", "--name-only", `${rev}:${CHANGES}`)),
  );
}

/** Files this branch added since it left origin/main: committed, staged,
 *  unstaged or untracked. */
function addedFiles(root, base) {
  return new Set([
    ...lines(git(root, "diff", "--name-only", "--diff-filter=A", base)),
    ...lines(git(root, "ls-files", "--others", "--exclude-standard")),
  ]);
}

const skeleton = (
  version,
  date,
) => `import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "${version}",
  date: "${date}",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md("", list(""), ""),
} satisfies ChangelogEntry;
`;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function main(argv) {
  const kind = argv[0];
  if (argv.length > 1 || (kind !== undefined && !KINDS.includes(kind)))
    die("usage: npm run contract:bump -- <patch|minor|major>");

  const root = git(process.cwd(), "rev-parse", "--show-toplevel");
  git(root, "fetch", "--quiet", "origin", "main");
  const base = git(root, "merge-base", "HEAD", "origin/main");
  const highest = versionsAt(root, "origin/main")[0];
  if (!highest) die(`origin/main has no ${CHANGES}/`);
  const added = addedFiles(root, base);
  const mine = [...added].filter(
    (f) => f.startsWith(`${CHANGES}/`) && f.endsWith(".ts"),
  );
  if (mine.length > 1)
    die(
      `this branch adds ${mine.length} version files (${mine.join(", ")}); one pull request takes one version`,
    );

  const today = new Date().toISOString().slice(0, 10);
  const pkg = path.join(root, "packages/contracts");

  if (mine.length === 0) {
    if (!kind) die("usage: npm run contract:bump -- <patch|minor|major>");
    const next = bumpVersion(highest, kind);
    const file = `${CHANGES}/${next}.ts`;
    writeFileSync(path.join(root, file), skeleton(next, today));
    writeIndex(pkg);
    console.log(`${highest} on origin/main; wrote ${file} (${kind}).`);
    console.log(`Write its summary, then stage: git add ${file}`);
    return;
  }

  const oldFile = mine[0];
  const old = path.basename(oldFile, ".ts");
  // The kind this branch chose: from the version before its own, which is
  // on origin/main (an earlier run counted from it) or, the first time, at
  // the point the branch left it.
  const before =
    [...versionsAt(root, "origin/main"), ...versionsAt(root, base)]
      .filter((v) => compareVersions(v, old) < 0)
      .sort((a, b) => compareVersions(b, a))[0] ?? highest;
  const chosen = kind ?? bumpKind(before, old);
  if (!chosen)
    die(
      `${old} is no patch, minor or major after ${before}; name one: npm run contract:bump -- <patch|minor|major>`,
    );
  const next = bumpVersion(highest, chosen);
  if (next === old) {
    console.log(
      `${old} is still the next ${chosen} after ${highest} on origin/main; nothing to do.`,
    );
    return;
  }
  if (compareVersions(next, highest) <= 0)
    die(`refusing to go back to ${next}`);

  const newFile = `${CHANGES}/${next}.ts`;
  if (existsSync(path.join(root, newFile))) die(`${newFile} already exists`);
  renameSync(path.join(root, oldFile), path.join(root, newFile));

  const mention = new RegExp(`\\bMCP ${escape(old)}(?!\\.?\\d)`, "g");
  const touched = [oldFile];
  const fragments = [...added]
    .filter((f) => f !== oldFile && FRAGMENTS.some((d) => f.startsWith(d)))
    .concat(newFile);
  for (const f of fragments) {
    const full = path.join(root, f);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, "utf8");
    let out = text.replace(mention, `MCP ${next}`);
    if (f === newFile)
      out = out.replace(
        new RegExp(`(\\bversion: )"${escape(old)}"`),
        `$1"${next}"`,
      );
    if (out !== text) writeFileSync(full, out);
    if (out !== text || f === newFile) touched.push(f);
  }
  writeIndex(pkg);
  console.log(
    `origin/main is at ${highest}: renumbered ${old} to ${next} (${chosen}).`,
  );
  console.log(`Stage: git add ${[...new Set(touched)].join(" ")}`);
}

main(process.argv.slice(2));
