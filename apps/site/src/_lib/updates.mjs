/**
 * Reads What's new from its directory, one file per entry
 * (src/_data/updates.js says the format). Kept out of the data file
 * because Eleventy takes a data module's named exports as its data.
 */
import { readFileSync, readdirSync } from "node:fs";

const NAME =
  /^(\d{4}-\d{2}-\d{2})-(?:(\d{2,})|t((?:[01]\d|2[0-3])[0-5]\d[0-5]\d))-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** The mark that puts an entry in every signed-in person's Timeline
 *  (2026-11-23): an HTML comment alone on the file's first line, so it
 *  never renders. The reader strips it; nothing else sees it. */
export const TIMELINE_MARK = "<!-- timeline -->";
/** The longest first paragraph a marked entry may have, as plain text:
 *  the Timeline shows it whole, never cut. */
export const TIMELINE_LEDE_MAX = 400;

/** A paragraph's Markdown as the plain words a person reads: links keep
 *  their text, code and bold lose their marks, lines join. */
const plainText = (md) =>
  String(md)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** An entry's page address under /updates/, from its date and title. The
 *  date leads it: two updates have shared a title before now, updates are
 *  read newest-first anyway, and a dated URL tells a reader how old the
 *  thing they are about to read is before they open it. */
export const updateSlug = (date, title) =>
  `${date}-${String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "")}`;

/** One entry from its file name and text; refuses any other shape. A
 *  marked entry (TIMELINE_MARK) also carries `timeline`: its UTC instant
 *  and its first paragraph as plain text. */
export function parseUpdate(name, text) {
  const m = NAME.exec(name);
  if (!m)
    throw new Error(
      `updates/${name}: name it <YYYY-MM-DD>-t<HHMMSS>-<slug>.md (UTC); legacy NN names are also read`,
    );
  const marked = text.startsWith(`${TIMELINE_MARK}\n`);
  const rest = marked ? text.slice(TIMELINE_MARK.length + 1) : text;
  if (/<!--\s*timeline\b/i.test(rest))
    throw new Error(
      `updates/${name}: ${TIMELINE_MARK} goes alone on the file's first line, above the title`,
    );
  const heading = /^# (\S[^\n]*?)\n\n(\S[\s\S]*?)\s*$/.exec(rest);
  if (!heading)
    throw new Error(
      `updates/${name}: a "# Title" line, a blank line, then the body`,
    );
  const entry = { date: m[1], title: heading[1], body: heading[2] };
  if (marked) {
    if (!m[3])
      throw new Error(
        `updates/${name}: only a timed entry (<YYYY-MM-DD>-t<HHMMSS>-<slug>.md) can be marked for the Timeline`,
      );
    const lede = plainText(heading[2].split(/\n\s*\n/)[0]);
    if (lede.length > TIMELINE_LEDE_MAX)
      throw new Error(
        `updates/${name}: a Timeline entry's first paragraph is shown whole, so keep it to ${TIMELINE_LEDE_MAX} characters (it has ${lede.length})`,
      );
    const t = m[3];
    entry.timeline = {
      at: `${m[1]}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.000Z`,
      lede,
    };
  }
  return {
    entry,
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
