import { ConfirmAction } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useInvalidate } from "../lib/queries.js";
import { useCommentsOn } from "./Comments.jsx";

/** What a block does, said the same way everywhere it is offered. */
export const BLOCK_WORDS =
  "You won't see each other's comments, and they can't comment on your play or cheer it. Any follows between you end. They won't be told. Battles and player pages stay as they are.";

/**
 * Block (2026-11-16): an account by its page id, or a player's verified
 * owner by the player's tag. Silent both ways; a block ends the follows
 * between you, so everything of yours reads again after it. Drawn only
 * while comments are on, and never on your own page or player.
 */
export function BlockButton({ account = null, playerTag = null, name }) {
  const on = useCommentsOn();
  const invalidate = useInvalidate();
  if (!on) return null;
  return (
    <ConfirmAction
      label="Block"
      className="btn btn--quiet btn--sm"
      title={name ? `Block ${name}?` : "Block them?"}
      body={<p className="m-0">{BLOCK_WORDS}</p>}
      confirm="Block"
      run={() =>
        api.block(account ? { account_id: account } : { player_tag: playerTag })
      }
      onDone={(out) => {
        if (out?.ok) invalidate();
      }}
    />
  );
}

/** Unblock: nothing the block ended comes back on its own. */
export function UnblockButton({ account, name, onDone = null }) {
  const invalidate = useInvalidate();
  return (
    <ConfirmAction
      label="Unblock"
      className="btn btn--sm"
      danger={false}
      title={name ? `Unblock ${name}?` : "Unblock them?"}
      body={
        <p className="m-0">
          You&rsquo;ll see each other&rsquo;s comments again. Follows the block
          ended don&rsquo;t come back on their own.
        </p>
      }
      confirm="Unblock"
      run={() => api.unblock(account)}
      onDone={(out) => {
        if (out?.ok) {
          invalidate();
          onDone?.(out);
        }
      }}
    />
  );
}
