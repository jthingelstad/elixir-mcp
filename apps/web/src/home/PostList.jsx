import { postsKey, usePosts } from "../lib/queries.js";
import { FeedItem } from "./FeedItem.jsx";
import { useScope } from "../lib/scope.js";

/** A player's or an account's posts (2026-11-17), on their page: the ones
 *  the reader may see, newest first, each drawn as the Timeline draws it,
 *  with its cheers and comments. Posts about battles always (0292: what
 *  highlights were); the rest only while posts are on, which the server
 *  decides. Never under an agent's scope, and nothing when there are none. */
export function PostList({ player = null, account = null, mine = false }) {
  const on = !useScope();
  const ask = { player, account, mine };
  const read = usePosts(ask, on);
  const posts = read.data?.posts ?? [];
  if (!on || posts.length === 0) return null;
  return (
    <section className="kit-post-list" aria-label="Posts">
      <h2 className="kit-day__head">Posts</h2>
      {posts.map((it) => (
        <FeedItem
          key={it.id}
          it={it}
          cheerWhere={{ key: postsKey(ask), list: "posts" }}
        />
      ))}
    </section>
  );
}
