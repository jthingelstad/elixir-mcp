import { postsKey, usePosts } from "../lib/queries.js";
import { PostReadState } from "./PostReadState.jsx";
import { FeedItem } from "./FeedItem.jsx";

/** A player's or an account's posts (2026-11-17), on their page: the ones
 *  the reader may see, newest first, each drawn as the Timeline draws it,
 *  with its cheers and comments. Posts about battles always (0292: what
 *  highlights were); the rest only while posts are on, which the server
 *  decides. Nothing when there are none. */
export function PostList({ player = null, account = null, mine = false }) {
  const ask = { player, account, mine };
  const read = usePosts(ask);
  const posts = read.data?.posts ?? [];
  return (
    <PostReadState query={read}>
      {posts.length > 0 ? (
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
      ) : null}
    </PostReadState>
  );
}
