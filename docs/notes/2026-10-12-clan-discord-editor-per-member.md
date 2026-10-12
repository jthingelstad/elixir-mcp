# 2026-10-12 — Elixir Clan's Discord editor: what a post told is counted per member

MCP and JSON API unchanged. No migration. Codex on #542, shipped in #543;
follows `2026-10-12-clan-discord-editor-earlier-sitting.md`. Moved here
from the first note, which had been extended (Codex on #543: one note per
change).

- P2: a post's kinds, moments and battles were the whole post's, and
  the editor may tell several members in one post, so another member's
  move could count as this member's sitting (or tie their battle to a
  sitting they never told). `toldToday` now keeps them per member and
  gives each member's list its own. `clan-sync.test` pins it with a
  shared post.
- P1: #542 changed what leaders see without a What's new entry; it has
  one now (`2026-10-12-08`).
