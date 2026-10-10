/**
 * `npm run contract:bump` against a scratch repository with an origin of
 * its own: the first bump counts from origin/main, and a second run
 * renumbers this branch's version once another pull request has taken
 * its number, touching only the files this branch added.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUMP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/bump.mjs",
);
const CHANGES = "packages/contracts/src/changes";

const entry = (version, summary = `What ${version} changed, for agents.`) =>
  `export default {\n  version: "${version}",\n  date: "2026-10-01",\n  summary: "${summary}",\n};\n`;

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

const read = (root, file) => readFileSync(path.join(root, file), "utf8");

function bump(cwd, ...args) {
  const r = spawnSync(process.execPath, [BUMP, ...args], {
    cwd,
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

/** A bare origin at 1.0.0 with a notes fragment, and a clone of it. */
function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "contract-bump-"));
  const origin = path.join(dir, "origin.git");
  const seed = path.join(dir, "seed");
  const work = path.join(dir, "work");
  git(dir, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  git(dir, "clone", "--quiet", origin, seed);
  for (const repo of [seed]) {
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
  }
  write(seed, ".gitignore", "packages/contracts/src/generated/\n");
  write(seed, `${CHANGES}/1.0.0.ts`, entry("1.0.0"));
  write(seed, "docs/notes/2026-10-01-old.md", "# old\n\nMCP 1.0.1 is mine.\n");
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "seed");
  git(seed, "push", "--quiet", "origin", "main");
  git(dir, "clone", "--quiet", origin, work);
  git(work, "config", "user.email", "test@example.com");
  git(work, "config", "user.name", "Test");
  git(work, "switch", "--quiet", "-c", "session/mine");
  return { dir, seed, work };
}

/** Another pull request merges a version of its own. */
function otherMerges(seed, version) {
  write(seed, `${CHANGES}/${version}.ts`, entry(version));
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", version);
  git(seed, "push", "--quiet", "origin", "main");
}

test("the first bump writes the next version from origin/main, dated today", (t) => {
  const { dir, seed, work } = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // origin/main moved after this branch began: the count starts there.
  otherMerges(seed, "1.1.0");

  assert.notEqual(bump(work).code, 0, "a branch with no version needs a kind");
  assert.notEqual(bump(work, "huge").code, 0);
  const r = bump(work, "patch");
  assert.equal(r.code, 0, r.out);
  const file = `${CHANGES}/1.1.1.ts`;
  const text = read(work, file);
  assert.match(text, /version: "1\.1\.1"/);
  const today = new Date().toISOString().slice(0, 10);
  assert.match(text, new RegExp(`date: "${today}"`));
  assert.match(text, /summary: md\(""/, "a skeleton the tests refuse");
  assert.equal(
    read(work, "packages/contracts/src/generated/latest-version.ts").includes(
      '"1.1.1"',
    ),
    true,
  );
  assert.match(bump(work).out, /nothing to do/, "run again: still next");
});

test("a second run renumbers an overtaken version and its mentions", (t) => {
  const { dir, seed, work } = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(bump(work, "patch").code, 0);
  write(work, `${CHANGES}/1.0.1.ts`, entry("1.0.1", "MCP 1.0.1: a fix."));
  write(
    work,
    "docs/notes/2026-10-10-mine.md",
    "# 2026-10-10 — mine\n\nShips in MCP 1.0.1. Not MCP 1.0.10 or MCP 1.0.1.5.\n",
  );
  write(
    work,
    "apps/site/src/_data/updates/2026-10-10-01-mine.md",
    "---\ntitle: Mine\n---\nA fix. MCP 1.0.1; JSON API 3.1.0 unchanged.\n",
  );
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "1.0.1");
  // Uncommitted work counts as this branch's too.
  write(work, "docs/notes/2026-10-10-draft.md", "Draft: MCP 1.0.1.\n");

  // Still the next patch: nothing moves.
  const same = bump(work);
  assert.equal(same.code, 0, same.out);
  assert.match(same.out, /nothing to do/);

  otherMerges(seed, "1.0.1");
  const r = bump(work);
  assert.equal(r.code, 0, r.out);
  assert.ok(!existsSync(path.join(work, `${CHANGES}/1.0.1.ts`)));
  const moved = read(work, `${CHANGES}/1.0.2.ts`);
  assert.match(moved, /version: "1\.0\.2"/);
  assert.match(moved, /MCP 1\.0\.2: a fix/);
  assert.equal(
    read(work, "docs/notes/2026-10-10-mine.md"),
    "# 2026-10-10 — mine\n\nShips in MCP 1.0.2. Not MCP 1.0.10 or MCP 1.0.1.5.\n",
  );
  assert.match(
    read(work, "apps/site/src/_data/updates/2026-10-10-01-mine.md"),
    /MCP 1\.0\.2; JSON API 3\.1\.0 unchanged/,
  );
  assert.equal(
    read(work, "docs/notes/2026-10-10-draft.md"),
    "Draft: MCP 1.0.2.\n",
  );
  // A file the branch did not add keeps its words.
  assert.equal(
    read(work, "docs/notes/2026-10-01-old.md"),
    "# old\n\nMCP 1.0.1 is mine.\n",
  );
  assert.match(
    read(work, "packages/contracts/src/generated/latest-version.ts"),
    /"1\.0\.2"/,
  );

  // A minor merged meanwhile: the branch's patch follows it.
  otherMerges(seed, "1.1.0");
  const again = bump(work);
  assert.equal(again.code, 0, again.out);
  assert.ok(existsSync(path.join(work, `${CHANGES}/1.1.1.ts`)));
  assert.match(read(work, "docs/notes/2026-10-10-mine.md"), /MCP 1\.1\.1\./);

  // Naming a kind changes it.
  const minor = bump(work, "minor");
  assert.equal(minor.code, 0, minor.out);
  assert.ok(existsSync(path.join(work, `${CHANGES}/1.2.0.ts`)));
});

test("a branch that adds two versions is refused", (t) => {
  const { dir, work } = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  write(work, `${CHANGES}/1.0.1.ts`, entry("1.0.1"));
  write(work, `${CHANGES}/1.0.2.ts`, entry("1.0.2"));
  const r = bump(work, "patch");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /adds 2 version files/);
});
