import {
  subjectsFor,
  itemVisibility,
} from "@elixir-mcp/tools/activity/entries";
import { feedOrder, HOME_WEEK_MS } from "@elixir-mcp/tools/activity/home-feed";
import { feedItemsFor, withCheers } from "./cheers.mjs";
import { withComments } from "./comments.mjs";
import { annotateFeed } from "./feed.mjs";
import { homePosts } from "./posts.mjs";
import { blockedSocialItems } from "./timeline-items.mjs";

/** One recorded item from the players just followed. Restrict both sources
 * before choosing the newest item so a busy account cannot crowd it out. */
export async function followedMoment(db, accountId, tags, { comments, posts }) {
  const asked = new Set(tags);
  const friends = (await subjectsFor(db, accountId)).filter(
    (s) =>
      s.kind === "player" && s.relationship === "friend" && asked.has(s.tag),
  );
  if (!friends.length) return { item: null };
  const named = friends.map((s) => s.tag);
  const { items } = await feedItemsFor(db, {
    accountId,
    tags: named,
    subjects: friends,
  });
  const now = Date.now();
  const authored = await homePosts(db, accountId, {
    subjects: friends,
    fromMs: now - HOME_WEEK_MS,
    toMs: now,
    plain: posts,
    subjectsOnly: true,
    visibleOnly: true,
    limit: 1,
  });
  const candidates = [
    ...items.filter(
      (it) =>
        it.kind !== "battle_highlight" &&
        named.includes(it.subject_tag) &&
        ["public", "member"].includes(itemVisibility(it)),
    ),
    ...authored,
  ].sort(feedOrder);
  const blocked = await blockedSocialItems(db, accountId, candidates);
  const item = candidates.find((it) => !blocked.has(it.id));
  if (!item) return { item: null };
  const decorated = await annotateFeed(db, [item], friends);
  const interactive = await withCheers(db, decorated, accountId);
  const [preview] = await withComments(db, interactive, accountId, {
    enabled: comments,
  });
  return { item: preview.can_cheer ? preview : null };
}
