# 2026-11-17 — Posts: answers refresh every card, and the docs ship

Codex on #1104: after a comment write, `useCommentsChanged` re-read only
the item's thread and Home's feed. A post's card on Clan's Feed or on a
page's post list kept its old count and preview. Deleting an answer and
tapping "Hide comments" there brought the deleted words back. It now
re-reads every post list (`["me", "posts"]`) and Clan's feeds too.
Pinned in `apps/web/test/posts.test.jsx`.

## The public docs ship with posts on

Jamie, 2026-11-17, relayed by the session that asked for this change:
"Let's ship the full posts work. I didn't mean to exclude that." Posts
deploy switched on (`PostsEnabled=true` at deploy; the parameter's
default stays false). So the docs held in #1100 ship here: a Posts
section on The timeline (`apps/site/src/docs/timeline.md`) and a What's
new entry. The Privacy and Terms paragraphs land separately (#1105).

Jamie approved the Privacy and Terms paragraphs (#1105, closing #1102),
with the Privacy one revised to "modify the language to allow posts to go
in those other channels": a post is to be treated as public and may go
out in Elixir's emails and notifications, RSS, Discord, to agents and on
link-open pages. This permits those channels; it builds none of them.
Today posts show on the Timeline, Clan's Feed, Profile and the player
page only, and the docs say so as today's behaviour rather than a
promise. DECISIONS' posts line records the direction.
