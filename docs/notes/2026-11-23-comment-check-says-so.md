# 2026-11-23 — Posting says it is being checked, and a refusal says why

Jamie's direction (2026-11-23): posting a comment or a post waits 4 to 6
seconds while the model reads it; say so, and when the words are refused,
the same message gives the reason and the words stay for an edit. The
check stays inside the posting request; nothing is stored or shown until
it passes. No asynchronous flow.

## What changed

- **Status line.** The comment composer, the post composer and the post
  edit form (`apps/web/src/home/check-words.jsx`, used by `Comments.jsx`
  and `Post.jsx`) draw a `role="status"` line under the box that reads,
  while the request is in flight, "Elixir checks every comment before it
  posts, so this takes a few seconds." (answer, post, question and edit
  have their own noun). The box is read-only meanwhile, so nothing typed
  during the check is lost when a success clears it. No animation, so
  nothing for reduced motion to stop.
- **One failure line.** Every non-success reads "Your comment wasn't
  posted." (post and question: "didn't go up"; edit: "Your changes
  weren't saved.") followed by the reason: the server's line, "That took
  too long. Try again." for the app's own timeout or the API's 504, or a
  connection line for a network failure. Focus returns to the box.
- **The word tables** (`REFUSAL_WORDS`, `POST_REFUSAL_WORDS` in
  `services/web-api/src/comment-check.mjs`) were rewritten so each line
  says what the problem is and what to change ("That reads as mean to a
  person. Keep the trash talk about the battle, not the player."). The
  app adds the "wasn't posted" part, so the lines are reasons only. A
  repeat of the same words now has its own line ("You already posted
  those words today. Say something new.") under the same `spam` category.
  `unavailable` reads "We couldn't check it just now. Try again."
- **Stock comments.** `STOCK_COMMENTS` (gg, ggs, gg wp, ggwp, wp, nice,
  nice one, well played, good game) match after case, spacing and end
  punctuation and pass without the model, logged as `comment_check`
  verdict `allow`, stage `filter`, category `stock`, at no cost (no
  migration: `stage` already allows `filter`, `category` is free text).
  The shortcut sits after the filters and the monthly cap and is reached
  only through `postComment`, so repeats, rate limits, the cooldown,
  blocks and audience checks all still apply; posts never take it, and
  emoji-only words still go to the model.
- **The wait.** `MODERATION_WAIT_MS = 12_000` replaces the 20 s
  `timeoutMs` on the web API's model bridge. That bridge instance carries
  only `moderate` (`services/web-api/src/index.mjs`); Clan's bridges keep
  their own waits. The bridge also tells the relay to wait no longer
  (`timeout_ms`, `model-bridge.mjs`).
- **A late pass is not written.** `checkComment` takes `writeBy`
  (`writeByOf(event)` in `deadline.mjs`: the request's soft deadline less
  3 s). A model pass that lands after it is logged as `error`/`late` and
  answered 503 unavailable.

## How we know a timeout is never followed by a stored comment

1. The only writer is the request that awaited the verdict: `postChecked`
   and `writeChecked` insert after `checkComment` returns `allow`, in the
   same call. A bridge timeout returns `outcome_unknown`, which is
   `error`, which returns 503 before any insert. A reply the relay writes
   later sits in S3 under a random id nobody reads again.
2. The bridge gives up at 12 s; the handler's soft deadline is 18.5 s
   (`deadline.mjs`: min(remaining, 20 s) less 1.5 s), and the app gives
   up at 20 s. So the server answers about 6 s before its own 504 and
   about 7 s before the app stops listening.
3. A pass that still arrives within 3 s of the soft deadline is not
   written (`writeBy`), so no insert starts that could straddle the 504.
4. Once the 504 fires, `handler.mjs` ends the database lease; any later
   query on it throws, so a route still running cannot write.

Pinned by `services/web-api/test/comments.test.mjs` (a real bridge with a
fake clock gives up at 12 s with nothing stored and the relay told 12 s;
nothing stored on refuse, error, paused or late) and
`test/comment-check.test.mjs` (the stock list).

## Left alone

- The posts' battle composer (`views/BattlePosts.jsx`) keeps its own
  "Checking" button and error line.
- The privacy page says a comment's words go to Anthropic before it
  posts; a stock comment's no longer do. Policy pages change only with
  Jamie's word, so the page is unchanged (it now says more is shared
  than is).

MCP and JSON API unchanged; no migration.
