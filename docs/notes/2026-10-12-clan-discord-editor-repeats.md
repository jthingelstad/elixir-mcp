# 2026-10-12 — Elixir Clan's Discord editor: one sitting, one post a day

MCP and JSON API unchanged. No migration. Deployed with no acceptance
family: nothing a tool serves changed.

## What went wrong

One member's morning went to the activity channel four times in two
hours: an arena move, the sitting that made it, the trophy rung from the
same battle, and an edit of the first post. Another member got three
posts in 25 minutes. Each was a separate story because the stories were
built only from the run's fresh items and the told rows' battle ids.
The arena move had been read off the roster before the battle log
delivered its battle, so its told row carried no battle, and nothing tied
the later rung or the sitting to it.

The same move was posted as one bare clause ("moved up to Summit of
Heroes."). The cause was missing facts at first read, not a timeout:
`storyContext` gave context only to stories with a battle, so a move
with no `promoted_by` got no clanmates and no day's promotions, and
`renderStory` took its single-clause path. The model being unreachable
is not the cause; the fallback is the code-mode render, word for word.
The battle was attached later (`pinArenaMoment`), and that is what the
09:18 edit was.

## The rule

- `foldToday` (clan-engine `stories.mjs`) runs after a run's stories are
  ready. For a one-member story of sitting kinds (arena, league, best,
  sitting, career wins and the like), it looks at the channel's posts
  about that member in the last 24 hours (`toldToday` in `clan-sync.mjs`:
  told rows grouped by post, the quality ledger's first post time and
  last words, and the member's battle times). A story that shares a
  battle with a post, or falls in the same sitting (battles under 30
  minutes apart, `sittingOf`), and happened at or before the post went
  up, is part of it. A sitting story is always part of its sitting's
  post.
- Part of a post under two hours old and among the channel's three
  newest, the story edits that post: the post's items are read again
  (`buildTimeline` filtered by id) and told with the new ones, at a
  revision above the post's. If they cannot all be read again, it is
  not edited. Part of an older post, every item is skipped as
  `already_told_today`, recorded once.
- A member's second sitting in a day is skipped the same way; a
  promotion or rung from a battle after the post is its own story.
- Stories of one sitting in one run are one post.
- The editor's packet gains `TOLD TODAY about <name>`: the channel's
  last three posts about the member today, in its own words (clipped to
  300 characters), and the system prompt says not to tell them again. A
  departure's packet gets none of it.

The render of a merged story tells each battle once: the member's name,
then "They also" for each further battle, then "In the same sitting they
went …", without repeating a best win already told.

## Product questions, and the briefs' answers

- *May the channel decline to tell a member's later moments, or edit an
  earlier post, instead of posting each?* `docs/product/timeline.md`
  principle 7: Clan's Discord is an editor that frames stories under the
  clan's policy, not one line per item; principle 10 of
  `docs/product/clan.md` says one story per moment. Taken as yes.
- *How long may a post be edited, and how many a member a day?* The
  briefs leave it open; the defaults (two hours, three newest, one
  sitting a day) are `[engineering]` in DECISIONS, from the report that
  asked for them.

## The bare fallback

`storyContext` now reads clanmates in the arena and the day's promotions
for an arena move or league promotion with no battle; the deck still
needs the battle and is never guessed. Such a move renders as "Har moved
up to Summit of Heroes, joining Ak and Tere there."

## Lookups

The editor's lookups are offered (tools sent with `tool_choice` auto and
the round note inviting them) and reachable (the sync runs
`editorResearch`); every run so far chose none.

## Tests

`clan-engine/test/stories.test.mjs` (`sittingOf`, the edit, the skip,
a later result, the one-sitting cap, a run's own merge, a bare move),
`clan-engine/test/editor.test.mjs` (TOLD TODAY),
`syndication/test/story-context.test.mjs` (a move without a battle) and
`syndication/test/clan-sync.test.mjs` (the morning end to end: the move
posted with who is there while the model is unreachable, the rung
editing it, a late league skipped with its reason).

## Codex on #541 (both P2, both fixed in the follow-up)

- `toldToday` returned before reading the members' battle times when
  nothing had been posted about them today, so a battle-less move and a
  rung or sitting of the same sitting, new in one run, were two posts.
  The battle times are now read first. `clan-sync.test` pins it with a
  move and a rung in one run.
- The one-sitting cap counted only an earlier post that held a sitting
  story; a morning told only as its move let an evening sitting through.
  A post today of any sitting kind (move, league, best, sitting) now
  counts, as does any story already kept for the member in the run.

## Codex on #542 (fixed in the second follow-up)

- P2: a post's kinds, moments and battles were the whole post's, and
  the editor may tell several members in one post, so another member's
  move could count as this member's sitting (or tie their battle to a
  sitting they never told). `toldToday` now keeps them per member and
  gives each member's list its own. `clan-sync.test` pins it with a
  shared post.
- P1: #542 changed what leaders see without a What's new entry; it has
  one now (`2026-10-12-08`).
