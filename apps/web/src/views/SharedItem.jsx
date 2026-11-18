import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Link, PageHead, Panel, useClock } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { answered } from "../client/index.ts";
import { useMe } from "../App.jsx";
import { followMeHref } from "../lib/player.js";
import { BattleView } from "./Battle.jsx";
import { FeedItem } from "../home/FeedItem.jsx";
import { memberPostKey, useMemberPost } from "../lib/queries.js";

export function SharedItemPage() {
  const { id } = useParams({ strict: false });
  const { me } = useMe();
  const query = useQuery({
    queryKey: ["public", "shared-item", id],
    queryFn: answered(() => api.publicSharedItem(id)),
    staleTime: 0,
  });
  const read = query.data?.ok ? query.data.data : null;
  useEffect(() => {
    document.title = "Shared Timeline item - Elixir";
  }, []);
  return (
    <SharedItem
      read={read}
      pending={query.isPending}
      failed={query.isError}
      retry={() => query.refetch()}
      me={me}
    />
  );
}

/** A post speaks for its author. A game item names its player subjects.
 * Use the member Follow page for the price, permissions and confirmation. */
function SharedFollow({ item, claims }) {
  if (!item) return null;
  const candidates =
    item.kind === "post"
      ? [{ tag: item.post?.author?.player_tag, name: item.post?.author?.name }]
      : (item.subjects ?? []).filter((subject) => subject.kind === "player");
  const held = new Set((claims ?? []).map((claim) => claim.player_tag));
  const fresh = new Map();
  for (const { tag, name } of candidates)
    if (tag && !held.has(tag)) fresh.set(tag, name || tag);
  if (!fresh.size) return null;
  return (
    <Link className="btn btn--gold" to={followMeHref([...fresh.keys()])}>
      {fresh.size === 1
        ? `Follow ${fresh.values().next().value}`
        : "Choose players to follow"}
    </Link>
  );
}

export function SharedItem({
  read,
  pending = false,
  failed = false,
  retry,
  me,
}) {
  const { when } = useClock();
  const back = encodeURIComponent(
    typeof window === "undefined" ? "/timeline" : window.location.pathname,
  );
  return (
    <div className="kit-shared-item">
      <PageHead title="Shared on Elixir" />
      {pending ? (
        <p role="status">Loading the shared item…</p>
      ) : failed ? (
        <Panel>
          <p>Elixir did not answer.</p>
          <button className="btn" onClick={retry}>
            Try again
          </button>
        </Panel>
      ) : !read?.item ? (
        <Panel>
          <h2>No item at this link</h2>
          <p>
            It may have been removed or reached the end of its time in Elixir.
          </p>
        </Panel>
      ) : (
        <>
          <p className="kit-tiny">{when(read.item.at)}</p>
          {read.item.kind === "battle" ? (
            <BattleView
              read={read.item}
              me={{ authenticated: false }}
              standIn
              sharing={false}
              invite={false}
              follow={false}
              cheers={false}
              heading="h2"
            />
          ) : (
            <FeedItem it={read.item} publicView />
          )}
        </>
      )}
      <section
        className="kit-cta"
        aria-label={me?.authenticated ? "Next steps" : "See more on Elixir"}
      >
        {!me?.authenticated && (
          <>
            <h2 className="kit-cta__title">See more on Elixir</h2>
            <p className="kit-cta__text">
              Follow your friends and your clan, see how they play, and cheer
              them on.
            </p>
          </>
        )}
        <div className="share-actions">
          {me?.authenticated ? (
            <>
              <SharedFollow item={read?.item} claims={me.claims} />
              <Link className="btn" to="/timeline">
                Open your Timeline
              </Link>
            </>
          ) : (
            <>
              <a
                className="btn btn--gold"
                href={`/signin?signup&return_to=${back}`}
              >
                Create an account
              </a>
              <a className="btn" href={`/signin?return_to=${back}`}>
                Sign in
              </a>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export function MemberPostPage() {
  const { id } = useParams({ strict: false });
  const query = useMemberPost(id);
  const item = query.data?.ok ? query.data.data?.item : null;
  return (
    <div className="kit-shared-item">
      <PageHead title={item?.post?.question ? "Question" : "Post"} />
      {query.isPending ? (
        <p role="status">Loading the post…</p>
      ) : query.isError ? (
        <Panel>
          <p>Elixir did not answer.</p>
          <button className="btn" onClick={() => query.refetch()}>
            Try again
          </button>
        </Panel>
      ) : item ? (
        <FeedItem
          it={item}
          cheerWhere={{ key: memberPostKey(id), list: "item" }}
        />
      ) : (
        <Panel>
          <h2>No post at this link</h2>
          <p>The post may be gone, or outside the posts you can see.</p>
        </Panel>
      )}
      <Link className="btn" to="/timeline">
        Open Timeline
      </Link>
    </div>
  );
}
