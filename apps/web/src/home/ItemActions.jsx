import { Icon } from "@elixir-mcp/ui";
import { dropPlayHref } from "../lib/drop.js";
import { Cheers } from "./Cheers.jsx";
import { Comments } from "./Comments.jsx";
import { ItemShare } from "./ItemShare.jsx";

/** Every Timeline card keeps its social controls together. Comment state
 * belongs to Comments; only its entry control moves into this shared row. */
export function ItemActions({
  it,
  cheerWhere,
  commentEntry = null,
  showComments = "comments" in it || Boolean(commentEntry),
  playHref = dropPlayHref(it),
}) {
  const renderActions = (comment = null, thread = null) => (
    <div className="kit-item-actions">
      <div
        className="kit-item-actions__row"
        role="group"
        aria-label="Item actions"
      >
        {"cheers" in it ? (
          <Cheers it={it} where={cheerWhere} compact />
        ) : (
          <span />
        )}
        {comment}
        {playHref ? (
          <a
            className="btn btn--quiet btn--sm kit-drop-play"
            href={playHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Play Elixir Drop (opens in a new tab)"
            title="Play Elixir Drop (opens in a new tab)"
          >
            <Icon name="gamepad-2" size={20} />
            Play
          </a>
        ) : null}
        <ItemShare it={it} compact />
      </div>
      {thread}
    </div>
  );
  return showComments ? (
    <Comments it={it} entry={commentEntry} renderActions={renderActions} />
  ) : (
    renderActions()
  );
}
