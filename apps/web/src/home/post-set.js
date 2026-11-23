/**
 * Posts' fixed words and the composer's reading of its words (2026-11-17),
 * away from the drawing so a test can pin them. The server's rules are
 * services/web-api/src/posts.mjs and comment-filter.mjs (POST_MAX); these
 * follow them.
 */
import { findDeckLink } from "@elixir-mcp/contracts";

/** The most a post may say, in characters. */
export const POST_MAX = 500;

/** The most loose cards a post carries. */
export const POST_CARDS_MAX = 8;

/** Whether posts are on for this reader: the stack's switch (`/api/me`
 *  `features.posts`, true only while comments are on too). */
export const postsOn = (me) =>
  me?.features?.posts === true && me?.features?.comments === true;

/** Whether the account may post: a Verified player of its own, its main
 *  or an alt, as for commenting. */
export const canPost = (me) =>
  (me?.claims ?? []).some(
    (c) =>
      c.status === "verified" &&
      (c.is_primary ||
        c.relationship === "primary" ||
        c.relationship === "alt"),
  );

/**
 * What the composer will send, read from its words as the server reads
 * them: a deck link from the game is taken out and becomes the deck; any
 * other link stays in the words (and the server refuses it). `length`
 * counts what is left, in characters.
 */
export function readDraft(text) {
  const found = findDeckLink(text ?? "");
  const words = found
    ? `${text.slice(0, found.index)}${text.slice(found.index + found.link.length)}`
    : (text ?? "");
  const tidy = words.replace(/\s+/g, " ").trim();
  return {
    words: tidy,
    deck: found?.deck ?? null,
    length: [...tidy].length,
  };
}

/** The average elixir of cards with costs, to one decimal; null when any
 *  cost is missing. */
export function averageElixir(cards) {
  const costs = (cards ?? []).map((c) => c?.elixir_cost);
  if (costs.length === 0 || costs.some((c) => typeof c !== "number"))
    return null;
  return (
    Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 10) / 10
  );
}

/** The words above a refused post: the server's own line when it gave
 *  one, else a plain one. */
export function refusalWords(res) {
  return res?.data?.message ?? "Your post wasn't posted. Try again.";
}
