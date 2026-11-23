/**
 * The updates list as the Updates page reads it: What's new, newest
 * first, each entry carrying a KIND (shipped or retired) and its page's
 * address. A retirement is read from the update's title, so nobody
 * maintains a kind by hand.
 */
import updates from "./updates.js";
import { updateSlug } from "../_lib/updates.mjs";

const RETIRED = /\b(retired|retire|retires|gone|removed|deleted|dropped)\b/i;

// updates.js is already newest first. Every entry is a page, so every
// entry needs a stable address (updateSlug, which the Timeline's product
// updates link to as well).
export default updates.map((u) => ({
  ...u,
  kind: RETIRED.test(u.title) ? "retired" : "shipped",
  slug: updateSlug(u.date, u.title),
}));
