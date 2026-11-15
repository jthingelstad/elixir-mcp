/**
 * The workflow lint (infra/scripts/test-workflows.sh, #447) passes this
 * repository's workflows and still fails on each rule's violation: a
 * clean workflow in a scratch directory, then one break at a time. A
 * lint that cannot fail is no gate.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SCRIPT = path.join(repoRoot, "infra/scripts/test-workflows.sh");
const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

function lint(args) {
  const r = spawnSync("sh", [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** A validate.yml that keeps every rule. */
const CLEAN = `name: validate
on:
  pull_request:
permissions: {}
jobs:
  build:
    name: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: ./local-action
      - run: npm test
  lint:
    name: lint
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: checkout
        uses: "actions/checkout@${SHA}"
        with:
          persist-credentials: false
  validate:
    name: validate
    if: always()
    needs: [build, lint]
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - run: test "\${{ needs.build.result }}" = success
`;

function scratch(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), "workflows-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files))
    writeFileSync(path.join(dir, name), body);
  return dir;
}

test("workflow lint: this repository's workflows pass", () => {
  const r = lint([]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, / 0 failed/);
  assert.doesNotMatch(r.out, /failed to run/);
});

test("workflow lint: a clean workflow passes, a block needs list included", (t) => {
  const r = lint([scratch(t, { "validate.yml": CLEAN })]);
  assert.equal(r.code, 0, r.out);
  const block = CLEAN.replace(
    "needs: [build, lint]",
    "needs:\n      - build\n      - lint",
  );
  const b = lint([scratch(t, { "validate.yml": block })]);
  assert.equal(b.code, 0, b.out);
});

test("workflow lint: each violation fails, naming its rule", (t) => {
  const breaks = [
    [
      "a tag instead of a SHA",
      CLEAN.replace(`actions/checkout@${SHA} # v7.0.1`, "actions/checkout@v7"),
      /FAIL - validate\.yml: every action is pinned/,
    ],
    [
      "a short SHA",
      CLEAN.replace(
        `actions/checkout@${SHA} # v7.0.1`,
        "actions/checkout@3d3c42e",
      ),
      /FAIL - validate\.yml: every action is pinned/,
    ],
    [
      "an uppercase SHA",
      CLEAN.replace(
        `actions/checkout@${SHA} # v7.0.1`,
        `actions/checkout@${SHA.toUpperCase()}`,
      ),
      /FAIL - validate\.yml: every action is pinned/,
    ],
    [
      "no top-level permissions",
      CLEAN.replace("permissions: {}\njobs:", "jobs:"),
      /FAIL - validate\.yml: no default token permissions/,
    ],
    [
      "top-level write-all",
      CLEAN.replace("permissions: {}\njobs:", "permissions: write-all\njobs:"),
      /FAIL - validate\.yml: no default token permissions/,
    ],
    [
      "a job with no permissions",
      CLEAN.replace(
        "  lint:\n    name: lint\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n",
        "  lint:\n    name: lint\n    runs-on: ubuntu-latest\n",
      ),
      /FAIL - validate\.yml: every job sets its own permissions\n\s+job lint/,
    ],
    [
      "a checkout that keeps the token",
      CLEAN.replace(
        "          fetch-depth: 0\n          persist-credentials: false\n",
        "          fetch-depth: 0\n",
      ),
      /FAIL - validate\.yml: no checkout persists the token/,
    ],
    [
      // The count-based check this replaced passed this: two checkouts,
      // two settings, one of them on the wrong step.
      "persist-credentials on the wrong step",
      CLEAN.replace(
        "          fetch-depth: 0\n          persist-credentials: false\n      - uses: ./local-action\n",
        "          fetch-depth: 0\n      - uses: ./local-action\n        with:\n          persist-credentials: false\n",
      ),
      /FAIL - validate\.yml: no checkout persists the token/,
    ],
    [
      "pull_request_target",
      CLEAN.replace("on:\n  pull_request:", "on:\n  pull_request_target:"),
      /FAIL - validate\.yml: no pull_request_target trigger/,
    ],
    [
      "the validate job renamed",
      CLEAN.replace(
        "    name: validate\n    if:",
        "    name: Validate\n    if:",
      ),
      /FAIL - gate: .*\n\s+the validate job is named "Validate"/,
    ],
    [
      "the validate job without always()",
      CLEAN.replace("    if: always()\n", ""),
      /FAIL - gate: .*\n\s+the validate job needs if: always\(\)/,
    ],
    [
      "a job the validate job does not need",
      CLEAN.replace("needs: [build, lint]", "needs: [build]"),
      /FAIL - gate: .*\n\s+the validate job does not need lint/,
    ],
    [
      "no validate job at all",
      CLEAN.replace(/ {2}validate:\n[\s\S]*$/, ""),
      /FAIL - gate: .*\n\s+no job named validate/,
    ],
  ];
  for (const [what, body, re] of breaks) {
    assert.notEqual(body, CLEAN, `${what}: the fixture edit applied`);
    const r = lint([scratch(t, { "validate.yml": body })]);
    assert.equal(r.code, 1, `${what}\n${r.out}`);
    assert.match(r.out, re, what);
  }
});

test("workflow lint: another workflow file is held to the same rules, and validate.yml must exist", (t) => {
  const other = CLEAN.replace("name: validate\n", "name: other\n").replace(
    `actions/checkout@${SHA} # v7.0.1`,
    "actions/checkout@main",
  );
  const r = lint([scratch(t, { "validate.yml": CLEAN, "other.yaml": other })]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL - other\.yaml: every action is pinned/);

  const missing = lint([scratch(t, { "release.yml": CLEAN })]);
  assert.equal(missing.code, 1, missing.out);
  assert.match(missing.out, /FAIL - gate: validate\.yml exists/);

  const empty = lint([scratch(t, {})]);
  assert.equal(empty.code, 1, empty.out);
});
