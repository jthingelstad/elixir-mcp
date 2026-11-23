/**
 * Product updates in Home's Timeline (2026-11-23,
 * docs/notes/2026-11-23-product-updates-in-the-timeline.md): a What's new
 * entry marked for everyone (apps/site/src/_lib/updates.mjs, TIMELINE_MARK)
 * is a story from Elixir in every signed-in person's feed, placed by the
 * entry's own UTC time, for the feed's own week.
 *
 * Its own source, beside the stored week and the live posts, merged into
 * Home's read at one seam (routes/home.mjs readFeed). Never stored: not in
 * home_feed, not in timeline_story and not in its shadow, so the stored
 * Timeline's later stages can move it without untangling it. No table: the
 * entries come from the repository at build time (packages/docs
 * dist/timeline-updates.json), so the Markdown file is the one source.
 *
 * Quiet by design: Home's feed only. No bell, push, mail, Discord, RSS or
 * MCP reader reads this module, and the item takes no cheers or comments.
 */
import { timelineUpdates } from "@elixir-mcp/docs/src/timeline.mjs";

const PRODUCT_UPDATE = "product_update";

/** Whether an item is a product update. */
export const isProductUpdate = (it) => it?.kind === PRODUCT_UPDATE;

/** One marked entry as a feed item: from Elixir, about no player or clan,
 *  under no chip but Everyone and no mode. */
function productUpdateItem(u) {
  return {
    id: u.id,
    kind: PRODUCT_UPDATE,
    section: "product",
    at: u.at,
    sort_at: u.at,
    observed_at: u.at,
    subject_tag: null,
    subjects: [],
    groups: [],
    text: u.title,
    product_update: { title: u.title, lede: u.lede, path: u.path },
  };
}

/** The marked entries whose time falls inside a window, as feed items,
 *  newest first. An entry is the same for everyone: an account made after
 *  it still sees it while it is inside the window. */
export function productUpdatesIn(entries, { fromMs, toMs }) {
  return (entries ?? [])
    .filter((u) => {
      const at = Date.parse(u.at);
      return Number.isFinite(at) && at >= fromMs && at <= toMs;
    })
    .map(productUpdateItem)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** The production reader: the marked entries this build carries. */
export async function readProductUpdates(window) {
  return productUpdatesIn(await timelineUpdates(), window);
}

/**
 * Runs Home's per-item additions (chips, cheers, comments) over the other
 * items only, and puts the product updates back in their places. `decorate`
 * maps a list to a list of the same length, in order, as annotateFeed,
 * withCheers and withComments do.
 */
export async function besideProductUpdates(items, decorate) {
  const rest = items.filter((it) => !isProductUpdate(it));
  const done = rest.length > 0 ? await decorate(rest) : [];
  let i = 0;
  return items.map((it) => (isProductUpdate(it) ? it : done[i++]));
}
