/**
 * What's new is one file per entry, src/_data/updates/, so parallel pull
 * requests never edit one line. The reader keeps the old list's promises:
 * date, title and body exactly as written, newest first, and a new entry
 * sorts first on its day without renaming any other.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import updates from "../src/_data/updates.js";
import { parseUpdate } from "../src/_lib/updates.mjs";

const dir = new URL("../src/_data/updates/", import.meta.url);

test("every file in updates/ is an entry", () => {
  const files = readdirSync(dir);
  assert.ok(
    files.every((f) => f.endsWith(".md")),
    "only <YYYY-MM-DD>-<NN>-<slug>.md files belong in updates/",
  );
  assert.equal(updates.length, files.length);
});

test("an entry is its date, its title line and its body, exactly", () => {
  assert.deepEqual(
    parseUpdate(
      "2026-10-10-03-a-title.md",
      '# A title: with "quotes"\n\nThe body, `code` and all.\nMCP 11.7.2.\n',
    ),
    {
      entry: {
        date: "2026-10-10",
        title: 'A title: with "quotes"',
        body: "The body, `code` and all.\nMCP 11.7.2.",
      },
      order: 3,
    },
  );
});

test("a file of any other shape is refused", () => {
  for (const name of [
    "2026-10-10-a-title.md",
    "2026-10-10-1-a-title.md",
    "2026-10-10-01-A-Title.md",
    "2026-10-10-01-.md",
  ])
    assert.throws(() => parseUpdate(name, "# T\n\nBody.\n"), /name it/, name);
  for (const text of ["T\n\nBody.\n", "# T\nBody.\n", "# T\n\n", "#  T\n\nB\n"])
    assert.throws(
      () => parseUpdate("2026-10-10-01-t.md", text),
      /a "# Title" line/,
      JSON.stringify(text),
    );
});

test("newest day first, and the highest number first within a day", () => {
  assert.equal(
    parseUpdate("2026-10-10-10-newest.md", "# x\n\ny\n").order,
    10,
    "NN is a number, so 10 sorts above 09",
  );
  for (let i = 1; i < updates.length; i++)
    assert.ok(
      updates[i - 1].date >= updates[i].date,
      `${updates[i - 1].title} sits above a newer entry`,
    );
});

/** Days whose number two entries already shared before this test
 *  (2026-11-13). They keep their numbers: renumbering one would move it
 *  within its day, and the reader orders a pair by file name. The list
 *  only shrinks. */
const SHARED_BEFORE = [
  "2026-10-10-11",
  "2026-10-11-07",
  "2026-10-11-09",
  "2026-11-05-03",
  "2026-11-06-02",
  "2026-11-06-04",
  "2026-11-06-09",
  "2026-11-10-02",
  "2026-11-13-218",
];

test("no two entries share a day's number: a new one takes the day's next free one", () => {
  const seen = new Map();
  for (const name of readdirSync(dir)) {
    const key = /^(\d{4}-\d{2}-\d{2}-\d{2,})-/.exec(name)?.[1];
    if (key) seen.set(key, [...(seen.get(key) ?? []), name]);
  }
  const shared = [...seen].filter(([, names]) => names.length > 1);
  const fresh = shared.filter(([key]) => !SHARED_BEFORE.includes(key));
  assert.deepEqual(
    fresh.map(([, names]) => names),
    [],
    "rename the newer file to the day's highest number plus one",
  );
  assert.deepEqual(
    SHARED_BEFORE.filter((key) => !seen.has(key) || seen.get(key).length < 2),
    [],
    "a pair in SHARED_BEFORE no longer shares its number: take it off the list",
  );
});
