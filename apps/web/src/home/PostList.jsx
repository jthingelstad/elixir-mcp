import { usePosts } from "../lib/queries.js";
import { FeedItem } from "./FeedItem.jsx";
import { usePostsOn } from "./Post.jsx";

/** A player's or an account's posts (2026-11-17), on their page: the ones
 *  the reader may see, newest first, each drawn as the Timeline draws it,
 *  with its cheers and comments. Nothing while posts are off or there are
 *  none. */
export function PostList({ player = null, account = null, mine = false }) {
  const on = usePostsOn();
  const read = usePosts({ player, account, mine }, on);
  const posts = read.data?.posts ?? [];
  if (!on || posts.length === 0) return null;
  return (
    <section className="kit-post-list" aria-label="Posts">
      <h2 className="kit-day__head">Posts</h2>
      {posts.map((it) => (
        <FeedItem key={it.id} it={it} />
      ))}
    </section>
  );
}
