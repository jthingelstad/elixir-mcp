import { useEffect } from "react";
import { useParams, useSearch } from "@tanstack/react-router";
import { Link, PageHead, Panel } from "@elixir-mcp/ui";
import { readMemberItemPath } from "@elixir-mcp/ui/item-link";
import { FeedItem } from "../home/FeedItem.jsx";
import { memberItemKey, useMemberItem } from "../lib/queries.js";

export function MemberItemPage() {
  const { id } = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const target = readMemberItemPath(id, search);
  const query = useMemberItem(id, target?.ref);
  const item = query.data?.ok ? query.data.data?.item : null;
  useEffect(() => {
    document.title = "Timeline update - Elixir";
  }, []);
  return (
    <div className="kit-shared-item">
      <PageHead
        title={
          item?.kind === "post"
            ? item.post?.question
              ? "Question"
              : "Post"
            : "Timeline update"
        }
      />
      {target && query.isPending ? (
        <p role="status">Loading the item…</p>
      ) : query.isError ? (
        <Panel>
          <p>Elixir did not answer.</p>
          <button className="btn" onClick={() => query.refetch()}>
            Try again
          </button>
        </Panel>
      ) : item ? (
        <FeedItem
          key={`${id}:${target?.entry?.reply ?? ""}`}
          it={item}
          commentEntry={target.entry}
          cheerWhere={{ key: memberItemKey(id), list: "item", exact: false }}
        />
      ) : (
        <Panel>
          <h2>This item isn't available to you</h2>
          <p>It may have been removed, or its audience may have changed.</p>
        </Panel>
      )}
      <Link className="btn" to="/timeline">
        Open Timeline
      </Link>
    </div>
  );
}
