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
import {
  TIMELINE_LEDE_MAX,
  TIMELINE_MARK,
  parseUpdate,
  readUpdates,
  updateSlug,
} from "../src/_lib/updates.mjs";

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
      '# A title: with "quotes"\n\nThe body, `code` and all.\nA second line.\n',
    ),
    {
      entry: {
        date: "2026-10-10",
        title: 'A title: with "quotes"',
        body: "The body, `code` and all.\nA second line.",
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

test("a marked entry is for everyone's Timeline: the mark is read and stripped", () => {
  const { entry } = parseUpdate(
    "2026-11-23-t151929-news.md",
    `${TIMELINE_MARK}\n# News\n\nThe **first** paragraph, with [a link](/docs/home) and \`code\`,\nover two lines.\n\nA second paragraph.\n`,
  );
  assert.deepEqual(entry, {
    date: "2026-11-23",
    title: "News",
    body: "The **first** paragraph, with [a link](/docs/home) and `code`,\nover two lines.\n\nA second paragraph.",
    timeline: {
      at: "2026-11-23T15:19:29.000Z",
      lede: "The first paragraph, with a link and code, over two lines.",
    },
  });
  // Unmarked entries carry nothing new.
  assert.equal(
    parseUpdate("2026-11-23-t151929-news.md", "# News\n\nBody.\n").entry
      .timeline,
    undefined,
  );
});

test("a marked entry is refused when it would need cutting or is misplaced", () => {
  const long = "word ".repeat(TIMELINE_LEDE_MAX / 5 + 1).trim();
  assert.throws(
    () =>
      parseUpdate(
        "2026-11-23-t151929-long.md",
        `${TIMELINE_MARK}\n# Long\n\n${long}\n`,
      ),
    /first paragraph is shown whole/,
  );
  // Exactly at the limit is fine.
  const fits = "x".repeat(TIMELINE_LEDE_MAX);
  assert.equal(
    parseUpdate(
      "2026-11-23-t151929-fits.md",
      `${TIMELINE_MARK}\n# Fits\n\n${fits}\n\nMore below.\n`,
    ).entry.timeline.lede,
    fits,
  );
  // Only on the first line, alone.
  for (const text of [
    `# T\n\n${TIMELINE_MARK}\nBody.\n`,
    `# T\n\nBody.\n\n${TIMELINE_MARK}\n`,
    `\n${TIMELINE_MARK}\n# T\n\nBody.\n`,
  ])
    assert.throws(
      () => parseUpdate("2026-11-23-t151929-t.md", text),
      /first line/,
      JSON.stringify(text),
    );
  // A marked entry still needs its title and body.
  assert.throws(
    () => parseUpdate("2026-11-23-t151929-t.md", `${TIMELINE_MARK}\nBody.\n`),
    /a "# Title" line/,
  );
  // Only a timed entry has a time to be placed at.
  assert.throws(
    () => parseUpdate("2026-11-23-01-t.md", `${TIMELINE_MARK}\n# T\n\nBody.\n`),
    /only a timed entry/,
  );
});

test("the mark never reaches a reader: no entry's body holds it", () => {
  for (const u of updates) assert.ok(!u.body.includes("<!--"), u.title);
  assert.ok(
    updates.some((u) => u.timeline),
    "the entry that announced product updates is marked",
  );
});

test("an entry's address is its date and title, the one function", () => {
  assert.equal(
    updateSlug("2026-11-23", "News from Elixir: now in your Timeline!"),
    "2026-11-23-news-from-elixir-now-in-your-timeline",
  );
});
