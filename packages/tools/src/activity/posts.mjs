/** Person-scoped post delivery, separate from the game-record Timeline.
 * The canonical member reader owns audience, moderation and attachments.
 * External items carry facts and a member destination, never web controls,
 * comments, private names or permission to publish them elsewhere.
 */
import { readVisiblePostPage, memberPostUrl } from "@elixir-mcp/posts";
import { capTimeline, localOf } from "./entries.mjs";

export const EMPTY_POST_PAGE = { items: [], more: 0, more_at: null };

export async function readPostTimeline(db, accountId, options) {
  const page = await readVisiblePostPage(db, accountId, options);
  return {
    ...page,
    items: page.items.map((item) => {
      const post = item.post;
      const name = post.author.name;
      return {
        id: item.id,
        revision: item.revision,
        kind: "post",
        schema: "post/1",
        section: "posts",
        at: item.at,
        sort_at: item.sort_at,
        observed_at: item.observed_at,
        at_unix: Math.floor(Date.parse(item.sort_at) / 1000),
        local: localOf(item.sort_at, options.timezone ?? "UTC"),
        late:
          options.basis !== "occurred" &&
          Date.parse(item.sort_at) <= options.fromMs,
        subject_tag: item.subject_tag,
        subject_name: name,
        subjects: item.subjects,
        text: post.text,
        visibility: "followers",
        publishable: false,
        facts: {
          player_tag: item.subject_tag,
          name,
          post_id: post.id,
          words: post.text,
          question: post.question,
          answered: post.answered === true,
          deck: post.deck,
          cards: post.cards,
          url: memberPostUrl(post.id),
        },
      };
    }),
  };
}

/** Merge before the existing item and character caps, selecting by the
 * window's basis while preserving creation-time display order. */
export function mergePostTimeline(built, page, basis) {
  const instant = (item) =>
    Date.parse(
      basis === "occurred"
        ? (item.sort_at ?? item.at)
        : (item.observed_at ?? item.at),
    );
  const { kept, cut } = capTimeline(
    [...built.timeline, ...page.items].sort((a, b) => instant(b) - instant(a)),
  );
  return {
    ...built,
    timeline: kept.sort(
      (a, b) => Date.parse(b.sort_at ?? b.at) - Date.parse(a.sort_at ?? a.at),
    ),
    timeline_dropped: [...(built.timeline_dropped ?? []), ...cut],
    post_more: page.more,
    post_more_at: page.more_at,
  };
}
