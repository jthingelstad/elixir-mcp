/**
 * Clan is a set of features inside Elixir, never a separate product or an
 * integration (Jamie, 2026-11-12), and a refactor is finished with a guard
 * against the old shape (Jamie, 2026-11-13). `no-clan-switch.test.mjs`
 * holds off the switch that could turn Clan off; this file holds off the
 * other shapes of a separate Clan, each removed on 2026-11-13. A shape
 * that comes back fails here, with the file and line.
 *
 * Dated history keeps its words: change notes, the frozen notes archive,
 * What's new entries, contract change files and applied migrations are
 * never read. Jamie's quoted approval lines keep theirs too (QUOTED).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const self = path.relative(root, fileURLToPath(import.meta.url));

/** Every tracked file outside dated history and this guard. */
function tracked() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(
      (file) =>
        file &&
        file !== self &&
        file !== "docs/NOTES.md" &&
        !file.startsWith("docs/notes/") &&
        !file.startsWith("apps/site/src/_data/updates/") &&
        !file.startsWith("packages/contracts/src/changes/") &&
        !file.startsWith("db/migrations"),
    );
}

/** The lines of `files` matching `pattern`, as `file:line`. */
function hits(files, pattern, allowed = () => false) {
  const found = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue; // a tracked file this checkout does not have
    }
    for (const [n, line] of text.split("\n").entries())
      if (pattern.test(line) && !allowed(line)) found.push(`${file}:${n + 1}`);
  }
  return found;
}

/** Where a person or an agent reads Clan's name: the app, the site and its
 *  docs, every package's and service's source, the mail fixtures, and the
 *  product briefs. Tests are not read: a test may say what must not
 *  appear. */
const SURFACE = (file) =>
  file.startsWith("apps/web/src/") ||
  file.startsWith("apps/site/src/") ||
  file.startsWith("docs/product/") ||
  /^(packages|services)\/[^/]+\/(src|fixtures)\//.test(file);

// Spelled in pieces so this file does not match itself.
const PRODUCT_NAME = new RegExp(["Elixir", " Clan"].join(""));
const APP_NAME = new RegExp(
  ["\\b[Tt]he Clan ", "app\\b|\\bClan's ", "app\\b|\\bclan's ", "app\\b"].join(
    "",
  ),
);

/** Jamie's own words, quoted where a decision is recorded, kept as said,
 *  and the style rule that names the old name to forbid it. */
const QUOTED = [
  'never "Elixir',
  "has no rules of its own",
  "links a departure to an open",
  "current open Elixir Clan season",
  "in the current open Elixir",
];

test("Clan is never named as a product of its own", () => {
  const files = tracked().filter(SURFACE);
  assert.ok(
    files.includes("packages/mail/src/clan-mail.mjs"),
    "the mail source is read",
  );
  assert.deepEqual(
    hits(files, PRODUCT_NAME, (line) => QUOTED.some((q) => line.includes(q))),
    [],
  );
});

test("Clan is never called an app of its own", () => {
  assert.deepEqual(hits(tracked().filter(SURFACE), APP_NAME), []);
});

test("the guard sees each shape", () => {
  assert.ok(PRODUCT_NAME.test(`x ${"Elixir"} Clan y`));
  for (const name of ["the Clan app", "Clan's app", "where the clan's app is"])
    assert.ok(APP_NAME.test(name), name);
  assert.ok(!APP_NAME.test("Clan's apply button"));
});
