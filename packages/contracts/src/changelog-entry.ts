/**
 * One contract changelog entry, and the two helpers its summary is
 * written with. Each version is its own file, src/changes/<version>.ts,
 * whose default export is its entry; `npm run contract:bump` writes the
 * next one (scripts/bump.mjs).
 */

export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  tools_added?: string[];
  breaking?: string;
}

/** A summary in Markdown: a lede paragraph, then one bullet per tool, then
 *  the closing line (Additive / migration). The site renders it; over the
 *  wire it reads as plain text either way. Paragraphs are joined by a
 *  blank line, bullets by one newline, so a bullet never runs into the
 *  paragraph before it. */
export const md = (...paragraphs: string[]) => paragraphs.join("\n\n");
export const list = (...items: string[]) =>
  items.map((i) => `- ${i}`).join("\n");
