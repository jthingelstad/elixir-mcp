/**
 * What's new is one file per entry, src/_data/updates/, so parallel pull
 * requests never edit one line. The reader keeps the old list's promises:
 * date, title and body exactly as written, newest first, and a new entry
 * sorts first on its day without renaming any other.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import updates from "../src/_data/updates.js";
import { parseUpdate, readUpdates } from "../src/_lib/updates.mjs";

const dir = new URL("../src/_data/updates/", import.meta.url);

test("every file in updates/ is an entry", () => {
  const files = readdirSync(dir);
  assert.ok(
    files.every((f) => f.endsWith(".md")),
    "only timestamped or legacy numbered Markdown entries belong in updates/",
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

test("parallel same-day entries use their own UTC time and slug", () => {
  const path = mkdtempSync(join(tmpdir(), "elixir-updates-"));
  const dir = pathToFileURL(`${path}/`);
  try {
    // Two sessions can choose names independently. Neither needs to read or
    // reserve the other's daily number, and both survive the combined build.
    writeFileSync(
      new URL("2026-11-17-t142536-clearer-posts.md", dir),
      "# Clearer posts\n\nRead the post.\n",
    );
    writeFileSync(
      new URL("2026-11-17-t142536-better-follows.md", dir),
      "# Better follows\n\nFind your friends.\n",
    );
    assert.deepEqual(readUpdates(dir), [
      { date: "2026-11-17", title: "Clearer posts", body: "Read the post." },
      {
        date: "2026-11-17",
        title: "Better follows",
        body: "Find your friends.",
      },
    ]);

    writeFileSync(
      new URL("2026-11-17-t150001-earlier-in-the-alphabet.md", dir),
      "# Later time\n\nLater.\n",
    );

    // Legacy entries keep their own order and words when newer fragments join.
    writeFileSync(
      new URL("2026-11-17-09-legacy-nine.md", dir),
      "# Legacy nine\n\nNine.\n",
    );
    writeFileSync(
      new URL("2026-11-17-10-legacy-ten.md", dir),
      "# Legacy ten\n\nTen.\n",
    );
    writeFileSync(
      new URL("2026-11-17-10-other-legacy-ten.md", dir),
      "# Other legacy ten\n\nAlso ten.\n",
    );
    writeFileSync(
      new URL("2026-11-16-t235959-yesterday.md", dir),
      "# Yesterday\n\nEarlier.\n",
    );
    assert.deepEqual(
      readUpdates(dir).map((u) => u.title),
      [
        "Later time",
        "Clearer posts",
        "Better follows",
        "Other legacy ten",
        "Legacy ten",
        "Legacy nine",
        "Yesterday",
      ],
    );
    assert.deepEqual(
      readUpdates(dir),
      readUpdates(dir),
      "same-day ties are deterministic",
    );
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test("a file of any other shape is refused", () => {
  for (const name of [
    "2026-10-10-a-title.md",
    "2026-10-10-1-a-title.md",
    "2026-10-10-01-A-Title.md",
    "2026-10-10-01-.md",
    "2026-10-10-t240000-a-title.md",
    "2026-10-10-t126000-a-title.md",
    "2026-10-10-t125960-a-title.md",
    "2026-10-10-t0102-a-title.md",
  ])
    assert.throws(() => parseUpdate(name, "# T\n\nBody.\n"), /name it/, name);
  for (const text of ["T\n\nBody.\n", "# T\nBody.\n", "# T\n\n", "#  T\n\nB\n"])
    assert.throws(
      () => parseUpdate("2026-10-10-01-t.md", text),
      /a "# Title" line/,
      JSON.stringify(text),
    );
});

test("newest day first, with legacy numbered entries still readable", () => {
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
