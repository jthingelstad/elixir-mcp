/**
 * Clan is a set of features inside Elixir, never a separate product
 * (Jamie, 2026-11-12). The switch that could turn it off - a stack
 * parameter, its condition, the functions' variable and the session's
 * feature flag - was removed on 2026-11-13, with every "off" branch.
 * This guard fails if any of its names comes back in source, tests,
 * docs or the template. Dated change notes and the frozen notes
 * archive keep their history.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const self = path.relative(root, fileURLToPath(import.meta.url));

// Spelled in pieces so this file does not match itself.
const NAMES = [
  ["Clan", "Internal"],
  ["HasInternal", "Clan"],
  ["CLAN_", "INTERNAL"],
  ["clan_", "internal"],
  ["clan", "Internal"],
].map((parts) => parts.join(""));
const PATTERN = new RegExp(NAMES.join("|"));

const HISTORY = (file) =>
  file === "docs/NOTES.md" || file.startsWith("docs/notes/");

test("no Clan switch: its names appear nowhere outside dated history", () => {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file && file !== self && !HISTORY(file));
  assert.ok(files.includes("infra/template.yaml"), "the template is read");
  const found = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue; // a tracked file this checkout does not have
    }
    for (const [n, line] of text.split("\n").entries())
      if (PATTERN.test(line)) found.push(`${file}:${n + 1}`);
  }
  assert.deepEqual(found, []);
});

test("the guard sees each name", () => {
  for (const name of NAMES) assert.ok(PATTERN.test(`x ${name} y`), name);
});
