# 2026-10-11 — A clan's Discord channel: previewing the editor

The third of three pull requests for Jamie's approval of 2026-10-11:
"rebuild Elixir Clan's Discord AI mode as an editor in elixir-mcp:
read-only research on the clan's record, may skip and merge items, no
time or links, checked against what it read". The first (#503, #504)
built the stories and Elixir's own render; the second (#505) made the
clan's model an editor. This one makes the leader's preview show the
editor, retires the line-by-line rewrite, and answers #505's review. No
migration. MCP and JSON API unchanged; the preview's answer and the
page's view are internal (`/api/clan`).

## The preview

- `editorPreviewRequest` (`clan-engine/src/editor.mjs`) is the editor's
  request as a leader's draft: the same packets and rules, `prompt` and
  the one answer tool (`write_posts`), no lookups (the system prompt
  leaves the lookups out). It goes through `model.write`, deferred and
  collected as before, and counts as one of the leaders' drafts.
- `clanEditorPreview` (was `clanRewritePreview`) builds the five newest
  stories as the sync does and returns `posts`, `stories` (the packets)
  and the request.
- The activity service applies `editorAnswer` to the answer. Each story
  comes back with `post` (the text, when the post goes under its key)
  and `with` (the other stories it tells), `told_in` (the post it is
  told in), `skipped` (the reason) or `refused` (why the model's post
  or skip was not taken; null when the model left it).
- `editorAnswer` also returns `rejected: [{ keys, why }]` for that.
- The page lists each post with Elixir's versions of the stories it
  tells, each skip with its reason, and each kept story with why. A
  story told inside another's post is not listed on its own.

## Review of #505 (Codex)

- A display name two current members share is not looked up ("More
  than one current member is named …").
- A post that names a story already told by an earlier post is refused
  whole (`key_reused`), never trimmed to its other keys.
- A departure must keep the sentence of Elixir's version that tells it
  word for word (`editorStory().must`), and a post with a reason word
  beside it (because, due to, inactive, kicked, rules …) is refused
  (`departure_words`). The packet and the system prompt say so.

## The consistency trace (DECISIONS 74, 145, 147, 148)

- A story over three hours late carries `late` (Elixir's `whenWords`
  prefix) and a `LATE:` packet line; a post that leaves those words out
  is refused (`when_dropped`). A departure's kept sentence leaves the
  prefix out.
- The clock check no longer takes a bare decimal ("3.25") for a time;
  "18:05", "6pm" and "6.05 pm" still are.
- `discordLine`'s unused `text` option is gone.
- Words: Settings (`Model.jsx`), the deliveries' chip ("by the clan's
  model", was "rewritten"), the page (posts, not lines; a run edits up to
  12 stories), `/docs/timeline` ("One line per item"), ENGINEERING (the
  editor's rounds and parallel lookups), OPERATIONS (the timeline lanes
  and their DLQs), comments, `packages/clan/AGENTS.md`, and a Discord
  delivery row in the consistency skill's `facets.md`.

## Retired

`rewriteLine`, `activityRewriteRequest`, `rewriteProblem`,
`activityRewritesFromDraft`, `groupable` and the `REWRITE_*` and
`ACTIVITY_EFFORT` constants (`clan-engine/src/activity.mjs`), with their
tests. `namesIn` and `rewriteText` stay; the editor uses them. The
page's view field `rewrites_per_day` is `editor_runs_per_day`.

## Words

`PURPOSES.discord_activity` says the model edits the channel; the page
says "Edited by the clan's own model" and "Have the clan's model edit
the channel", and counts runs. `/docs/clan-policy`, `/docs/limits` and
DECISIONS (the told-the-record, activity-channel and model lines) say
the editor.
