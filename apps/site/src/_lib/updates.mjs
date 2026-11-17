/**
 * Reads What's new from its directory, one file per entry
 * (src/_data/updates.js says the format). Kept out of the data file
 * because Eleventy takes a data module's named exports as its data.
 */
import { readFileSync, readdirSync } from "node:fs";

const NAME =
  /^(\d{4}-\d{2}-\d{2})-(?:(\d{2,})|t((?:[01]\d|2[0-3])[0-5]\d[0-5]\d))-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** One entry from its file name and text; refuses any other shape. */
export function parseUpdate(name, text) {
  const m = NAME.exec(name);
  if (!m)
    throw new Error(
      `updates/${name}: name it <YYYY-MM-DD>-t<HHMMSS>-<slug>.md (UTC); legacy NN names are also read`,
    );
  const heading = /^# (\S[^\n]*?)\n\n(\S[\s\S]*?)\s*$/.exec(text);
  if (!heading)
    throw new Error(
      `updates/${name}: a "# Title" line, a blank line, then the body`,
    );
  return {
    entry: { date: m[1], title: heading[1], body: heading[2] },
    ...(m[3] ? { time: m[3] } : { order: Number(m[2]) }),
  };
}

/** Every entry in a directory, newest first. */
export function readUpdates(dir) {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({
      name,
      ...parseUpdate(name, readFileSync(new URL(name, dir), "utf8")),
    }));

  // Newest day first, then UTC time. Timed fragments sit above the legacy
  // numbered entries on that day; those keep their old relative order.
  // Same-second or old-number ties use the file name, never a shared slot.
  files.sort(
    (a, b) =>
      b.entry.date.localeCompare(a.entry.date) ||
      (b.time ?? "").localeCompare(a.time ?? "") ||
      (b.order ?? 0) - (a.order ?? 0) ||
      b.name.localeCompare(a.name),
  );

  return files.map((f) => f.entry);
}
