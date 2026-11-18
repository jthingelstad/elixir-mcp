import { Cheers } from "./Cheers.jsx";
import { Comments } from "./Comments.jsx";
import { ItemShare } from "./ItemShare.jsx";

/** Every Timeline card keeps its social controls together. Comment state
 * belongs to Comments; only its entry control moves into this shared row. */
export function ItemActions({ it, cheerWhere, commentEntry = null }) {
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
        <ItemShare it={it} compact />
      </div>
      {thread}
    </div>
  );
  return "comments" in it || commentEntry ? (
    <Comments it={it} entry={commentEntry} renderActions={renderActions} />
  ) : (
    renderActions()
  );
}
