# 2026-11-12 — A highlight's post and edit wake Discord; an edit is the same item grown

Follow-up to social slice 4 (#762, PR #773), from two Codex findings on
that pull request.

## What changed

- **A post wakes the cross-post.** Creating a highlight wrote no outbox
  object, so a follower's Timeline to Discord waited for an unrelated
  admission. `wakeAfterHighlight` (packages/syndication, beside
  `wakeAfterFact`) wakes what the highlight's player reaches through
  `wakeSyndication`, the collector's own path; the web API's highlight
  routes call it after a post and after an edit that changes the words.
  Like `wakeAfterFact` it never fails the write it follows.
- **An edit is the same story grown.** Migration **0240** adds
  `battle_highlight.revision` (constant default 1, catalog-only) and an
  index on `(player_tag, updated_at)`. An edit that changes the words
  counts the revision up and stamps `updated_at`; the same words again
  change nothing and wake nothing. On the timeline the item keeps its id
  (from the highlight id) and `at` (when it was posted), takes
  `observed_at` from `updated_at` and `revision` from the column. An
  observed window selects it by `updated_at`, which is when the record
  last learned it (as a crossing's late proof moves its observed
  column), and the news check (`timelineNews`, source
  `player_highlights`) reads the same column; an occurred window still
  selects by `created_at`. So a poller is served the correction, and the
  Discord sync, which edits a message only at a higher revision, edits
  the line in place.
- **MCP 11.20.1** (patch, a correction): `battle_highlight` items can now
  arrive again at a higher revision. No field or schema changed. The
  public timeline docs say how an edit and a deletion read.

## Deletion

There is no retraction on the timeline or in syndication. A deleted
highlight leaves the timeline; a reader that already served it is told
nothing, and a line already cross-posted to Discord stays up (the relay
posts and edits, never deletes; an attested fact taken back in Clan
behaves the same). A deletion wakes nothing. Whether a deleted
highlight's Discord line should be taken down is a product question,
raised in the pull request; this change invents no delivery policy.

## Tests

- `services/web-api/test/highlight.test.mjs`: a post and a changed edit
  each wake the follower's sync; the same words and a deletion wake
  nothing; the edited item is the same id and `at` at revision 2.
- `packages/tools/test/timeline-highlight-edit.test.mjs`: an incremental
  observed read serves the edit at revision 2 with the same id and
  posting time; the news check finds it; an occurred read finds it where
  it was posted.
- `packages/syndication/test/sync.test.mjs`: the sync posts a highlight
  once and, after an edit, hands the relay an edit of the same key at a
  higher revision with the new words.
