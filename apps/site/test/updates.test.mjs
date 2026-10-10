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
