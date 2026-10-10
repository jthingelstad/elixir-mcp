/**
 * The changelog and the contract version must agree.
 *
 * Nothing checked this, and on 2026-09-08 it broke in the quietest possible
 * way: a session bumped the version with a string replace that silently
 * matched nothing, because another session had already moved the file past
 * the value it assumed. The build stayed green, the deploy stayed green, and
 * a changelog entry shipped labelled with a version that already existed --
 * below a newer one.
 *
 * Two sessions editing one repo is now normal here, so "the version is where
 * I left it" is not a safe assumption for any of them. These assertions are
 * cheap and they fail loudly at exactly the moment that assumption breaks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHANGELOG, CONTRACT_VERSION } from "../dist/index.js";
import { bumpKind, versionsIn } from "../scripts/changes-index.mjs";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = readdirSync(path.join(pkg, "src/changes"));

const parse = (v) => v.split(".").map(Number);

const compare = (a, b) => {
  const [A, B] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
};

test("the newest entry IS the current contract version", () => {
  // The one that would have caught the silent no-op bump. Shipping behaviour
  // under a version nobody can look up is worse than not writing it down.
  assert.equal(
    CHANGELOG[0].version,
    CONTRACT_VERSION,
    `changelog leads with ${CHANGELOG[0].version} but the contract is ${CONTRACT_VERSION}`,
  );
});

test("versions are unique", () => {
  const seen = new Set();
  for (const e of CHANGELOG) {
    assert.ok(!seen.has(e.version), `${e.version} appears twice`);
    seen.add(e.version);
  }
});

test("entries run newest to oldest", () => {
  // Agents read this to find out what changed since the version they cached.
  // Out of order, "everything above mine" quietly stops meaning that.
  for (let i = 1; i < CHANGELOG.length; i++)
    assert.ok(
      compare(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0,
      `${CHANGELOG[i - 1].version} is not newer than ${CHANGELOG[i].version}`,
    );
});

test("every entry carries a version, a date and a summary", () => {
  for (const e of CHANGELOG) {
    assert.match(e.version, /^\d+\.\d+\.\d+$/, `bad version: ${e.version}`);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `bad date on ${e.version}`);
    assert.ok(
      e.summary && e.summary.length > 40,
      `${e.version} needs a summary somebody can act on`,
    );
  }
});

// Since 2026-10-10 each version is its own file, src/changes/<version>.ts,
// and CONTRACT_VERSION is the highest of them, so no pull request edits a
// shared line. These hold the files to what the one list used to promise.

test("each version file's entry carries the file's version", async () => {
  for (const name of files) {
    const version = name.replace(/\.ts$/, "");
    const { default: entry } = await import(
      pathToFileURL(path.join(pkg, "dist/changes", `${version}.js`)).href
    );
    assert.equal(
      entry.version,
      version,
      `src/changes/${name} holds the entry for ${entry.version}`,
    );
  }
});

test("the changelog is every version file, and the contract the highest", () => {
  // A stale src/generated/ (a file added or renamed since the build) shows
  // here: the build writes it, so rebuild.
  const versions = versionsIn(files);
  assert.deepEqual(
    CHANGELOG.map((e) => e.version),
    versions,
    "CHANGELOG does not match src/changes/; npm run build",
  );
  assert.equal(CONTRACT_VERSION, versions[0]);
});

test("a version file is named <major>.<minor>.<patch>.ts", () => {
  assert.throws(() => versionsIn(["11.7.2.ts", "next.ts"]), /next\.ts/);
  assert.throws(() => versionsIn(["11.7.ts"]), /11\.7\.ts/);
  assert.deepEqual(versionsIn(["9.10.0.ts", "9.9.1.ts", "10.0.0.ts"]), [
    "10.0.0",
    "9.10.0",
    "9.9.1",
  ]);
});

test("each version is a semver successor of the one before it", () => {
  // Checked over the whole history: from 0.6.0, the first entry, no
  // version was skipped. A gap means two pull requests took versions
  // without seeing each other; `npm run contract:bump` renumbers.
  for (let i = CHANGELOG.length - 1; i > 0; i--) {
    const before = CHANGELOG[i].version;
    const after = CHANGELOG[i - 1].version;
    assert.ok(
      bumpKind(before, after),
      `${after} is not a patch, minor or major after ${before}`,
    );
  }
});
