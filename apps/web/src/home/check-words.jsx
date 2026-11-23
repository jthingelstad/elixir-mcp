/**
 * What a composer says while Elixir checks its words, and when they did
 * not go up (2026-11-23). A comment, a post and a post's edit are each
 * read before anything is stored, which takes a few seconds; the author
 * is told so while it runs, and a no says why, with the words kept for
 * an edit. The reasons are the server's own lines
 * (services/web-api/src/comment-check.mjs); this adds what happened in
 * front of them.
 */

/** Each composer's words, by what it writes. */
const KINDS = {
  comment: {
    checking:
      "Elixir checks every comment before it posts, so this takes a few seconds.",
    failed: "Your comment wasn't posted.",
  },
  answer: {
    checking:
      "Elixir checks every answer before it posts, so this takes a few seconds.",
    failed: "Your answer wasn't posted.",
  },
  post: {
    checking:
      "Elixir checks every post before it goes up, so this takes a few seconds.",
    failed: "Your post didn't go up.",
  },
  question: {
    checking:
      "Elixir checks every question before it goes up, so this takes a few seconds.",
    failed: "Your question didn't go up.",
  },
  edit: {
    checking:
      "Elixir checks your new words before they show, so this takes a few seconds.",
    failed: "Your changes weren't saved.",
  },
};

/** The one line when the words did not go up: what happened, then why.
 *  The app gave up waiting, or the API's own deadline answered, is "took
 *  too long"; the server's line names every other reason. */
export function notPostedWords(res, kind) {
  const { failed } = KINDS[kind] ?? KINDS.comment;
  const why =
    res?.error === "timeout" || res?.status === 504
      ? "That took too long. Try again."
      : res?.error === "network"
        ? "We couldn't reach Elixir. Check your connection and try again."
        : (res?.data?.message ?? "Try again.");
  return `${failed} ${why}`;
}

/** The status line under the box: empty until a check runs, then one
 *  sentence. Always drawn, so a screen reader hears it change. */
export function CheckingLine({ busy, kind }) {
  return (
    <p role="status" aria-live="polite" className="kit-tiny m-0">
      {busy ? (KINDS[kind] ?? KINDS.comment).checking : ""}
    </p>
  );
}
