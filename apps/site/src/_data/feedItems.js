/**
 * The What's-new feeds (feed.xml, feed.json): the newest entries of the
 * one updates stream, product updates and contract versions alike.
 *
 * Each item's id is its own page, /updates/<slug>, which does not move
 * when a newer entry ships. Until 2026-09-27 the GUID was the entry's
 * position in the list (`/updates#<date>-<n>`), so every ship renumbered
 * the rest, readers showed old items as new again, and the fragment
 * pointed at nothing (review 2026-09-27 §7.6). Contract versions were
 * missing too: the feed iterated updates.js, not updatesView.
 */
import site from "./site.js";
import updatesView from "./updatesView.js";

/** A reader wants what is new, not the whole history; /updates has it.
 *  Not exported: Eleventy reads a data module with a named export as its
 *  namespace, and the feeds came out empty. site.test.mjs states 50. */
const FEED_ITEMS = 50;

export default updatesView.slice(0, FEED_ITEMS).map((u) => ({
  ...u,
  url: `${site.url}/updates/${u.slug}`,
  // The pubDate's instant (rfc822 in eleventy.config.mjs): noon UTC of
  // the entry's day, the same in both feeds.
  published: `${String(u.date).slice(0, 10)}T12:00:00Z`,
}));
