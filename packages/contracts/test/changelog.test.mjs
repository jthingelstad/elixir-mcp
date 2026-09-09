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
import { CHANGELOG, CONTRACT_VERSION } from "../dist/index.js";

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
