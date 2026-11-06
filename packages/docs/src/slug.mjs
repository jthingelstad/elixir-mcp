/** GitHub-style heading slugs, the shape the code's docs pointers use
 *  (docsRef("recording", "the-games-own-last-seen")): lower-case, inline
 *  markup and quotation stripped, every other non-alphanumeric run a
 *  single hyphen, trimmed. The site's renderer (apps/site/eleventy.config.mjs)
 *  is the same on every heading without punctuation; keep H2 titles free
 *  of apostrophes and quotes and the two never disagree. */
export const slugOf = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_'"\u2018\u2019\u201c\u201d]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
