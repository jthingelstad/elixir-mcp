import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@elixir-mcp/ui";
import { useWrite } from "../client/index.ts";
import { api } from "../api.js";
import { HOME_CIRCLE_KEY, HOME_FEED_KEY } from "../lib/queries.js";

/**
 * Close friend, one tap (2026-11-16): a star that marks or unmarks a friend
 * you follow. The mark is yours alone: the other person is never told, and
 * no page anyone else reads carries it. Drawn on a player's page by
 * Following, on Settings' Friends rows and in the circle itself.
 *
 * A Verified player's follow is its account's follow too, so marking one of
 * that account's players marks them all; the reads it changes are read
 * again: the circle, the feed's Close friends chip, the player pages and
 * Settings' list.
 */
export function useCloseMark() {
  const queryClient = useQueryClient();
  return useWrite(api.setClose, {
    invalidate: async () => {
      for (const queryKey of [
        HOME_CIRCLE_KEY,
        HOME_FEED_KEY,
        ["me", "player"],
      ]) {
        await queryClient.cancelQueries({ queryKey });
        await queryClient.invalidateQueries({ queryKey });
      }
      // Settings' list reads the account itself; only that one key.
      await queryClient.invalidateQueries({ queryKey: ["me"], exact: true });
    },
  });
}

/** The star. `label` says whose mark it is for a screen reader. With
 *  `words`, the button says "Close friend" beside the star. */
export function CloseToggle({ tag, name, close, words = false, className }) {
  const write = useCloseMark();
  const who = name ?? tag;
  return (
    <button
      type="button"
      className={["kit-close", words ? "btn btn--sm" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      aria-pressed={close === true}
      aria-label={
        words
          ? undefined
          : close
            ? `${who}: close friend`
            : `Mark ${who} a close friend`
      }
      title={
        close
          ? "Close friend. Only you see this."
          : "Mark as a close friend. Only you see this."
      }
      disabled={write.busy}
      aria-busy={write.busy}
      onClick={() => write.run(tag, !close)}
    >
      <Icon name="star" size={16} />
      {words ? <span>{close ? "Close friend" : "Add to circle"}</span> : null}
    </button>
  );
}
