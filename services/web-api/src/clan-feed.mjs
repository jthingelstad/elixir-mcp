import { buildTimeline, shownAt } from "@elixir-mcp/tools/activity/entries";
import { feedOrder } from "@elixir-mcp/tools/activity/home-feed";
import { withCheers } from "./cheers.mjs";
import { withComments } from "./comments.mjs";
import { annotateFeed } from "./feed.mjs";
import { clanPosts } from "./posts.mjs";

/**
 * Clan's Feed (slice 8, #766): the clan's timeline for one signed-in member,
 * newest first. The clan's own items and its members' moments come from the
 * clan subject read comprehensively, its current members' posts ride along
 * (their posts about battles always, 0292; the rest while posts are on),
 * and nothing of the reader's own account (feedback answers, mail)
 * is in it.
 *
 * Who sees what is the timeline's own reader rule (`factItems`): a verified
 * member reads the clan's facts and a verified leader or co-leader also the
 * leaders-only ones, exactly as the same person reads this clan in Home's
 * Timeline or `elixir_timeline`. The Feed widens nothing. The Clan handler
 * proves the reader is in the clan before this runs.
 *
 * Each item goes out as the Timeline draws it (2026-11-17, feedItem): the
 * same component draws both, so they cannot drift.
 */
export const FEED_DAYS = 7;
const DAY_MS = 86_400_000;

/** One item, as the Feed draws it (2026-11-17): the item as the Timeline
 *  draws it, with the same fields Home's read adds (`annotateFeed`), so
 *  Clan's Feed and the Timeline share one component and cannot drift. The
 *  reader is the same member the timeline's reader rule already let read
 *  this item; nothing of Home's own is sent (the reader's groups, the
 *  Follow offer, cheers, comments; only a post carries its cheers and
 *  comments, since a clanmate may cheer and answer it here), and `at` is
 *  the instant it sorts by. */
const HOME_ONLY = ["groups", "offer_follow", "section"];
const feedItem = (it) => {
  const out = { ...it, at: shownAt(it) || it.at || null };
  for (const k of HOME_ONLY) delete out[k];
  return out;
};

export async function readClanFeed(
  db,
  account,
  clanTag,
  now = Date.now(),
  { posts = false, comments = false } = {},
) {
  const perf = {};
  const started = Date.now();
  const built = await buildTimeline(
    db,
    [{ kind: "clan", tag: clanTag, scope: "comprehensive" }],
    {
      fromMs: now - FEED_DAYS * DAY_MS,
      toMs: now,
      timezone: account.timezone ?? "UTC",
      accountId: account.accountId,
      interactive: true,
      // A post about a battle is read below as the post it is, so the
      // record's own line for it (kind battle_highlight) is left out here:
      // one item, not two.
      filter: (it) =>
        it.section !== "account" && it.kind !== "battle_highlight",
      // The Feed draws items, never a clan entry's activity counts, so it
      // skips the late-capture count (2026-11-12, "a clan's late counts
      // are read only when a read says them"): that count walks every
      // battle the record learned in the week, for every clan, and was
      // most of the Feed's time (2026-11-13). The items are the same.
      lateCounts: false,
      perf,
    },
  );
  // Where the Feed's time goes, each builder's name beside its ms, as Home's
  // timeline logs it (#649): the read is the timeline's own, shared.
  console.info(
    JSON.stringify({
      at: "clan_feed",
      ms: Date.now() - started,
      parts: perf,
    }),
  );
  // Its members' posts now (2026-11-17), read live: a clanmate sees a
  // member's posts here as they see the member's play. Never anyone's in
  // a block with the reader (posts.mjs). Posts about battles always (what
  // highlights were, 0292); posts about nothing in the record while posts
  // are on.
  // A post takes cheers and answers here too, so each carries the
  // reader's cheers and comments, as the Timeline's do (#1100, Codex).
  const found =
    account.kind === "person"
      ? await clanPosts(db, account.accountId, {
          clanTag,
          fromMs: now - FEED_DAYS * DAY_MS,
          toMs: now,
          plain: posts,
        })
      : [];
  const extra = found.length
    ? await withComments(
        db,
        await withCheers(db, found, account.accountId),
        account.accountId,
        { enabled: comments },
      )
    : [];
  const items = extra.length
    ? [...(built.timeline ?? []), ...extra].sort(feedOrder)
    : (built.timeline ?? []);
  return {
    clan_tag: clanTag,
    window_days: FEED_DAYS,
    items: (await annotateFeed(db, items, [])).map(feedItem),
    more: built.timeline_more ?? 0,
  };
}
