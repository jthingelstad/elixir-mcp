/**
 * The updates list as the Updates page reads it: What's new, newest
 * first, each entry carrying a KIND (shipped or retired) and its page's
 * address. A retirement is read from the update's title, so nobody
 * maintains a kind by hand.
 */
import updates from "./updates.js";

const RETIRED = /\b(retired|retire|retires|gone|removed|deleted|dropped)\b/i;

/** Every entry is a page, so every entry needs a stable address. The date
 *  leads it: two updates have shared a title before now, updates are read
 *  newest-first anyway, and a dated URL tells a reader how old the thing
 *  they are about to read is before they open it. */
const slugify = (date, title) =>
  `${date}-${String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "")}`;

// updates.js is already newest first.
export default updates.map((u) => ({
  ...u,
  kind: RETIRED.test(u.title) ? "retired" : "shipped",
  slug: slugify(u.date, u.title),
}));
