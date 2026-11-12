# 2026-11-12 — A clan's activity posts link back to Elixir, with no preview

Jamie's rulings recorded in DECISIONS "A clan's activity goes to a
Discord channel of its own, as an editor" (2026-11-11, A5: a link back to
Elixir; 2026-11-12: "make sure they do not have previews"; PR #816). The
older "no link" rule for the activity channel no longer holds.

- **One link per post.** `packages/syndication/src/story-link.mjs` picks
  the most specific page a clan member may open once signed in: the
  battle's public page for one member's battle the record holds (a
  promotion, a crossing, a sitting's best win, a highlight), the clan's
  War for a war story, its Standings for an award, the member's player
  page for another story about one member, and the clan's Feed for a
  join, a departure, a role change or a story about several members. A
  model post telling several stories links where they all do, else to
  the Feed. The sync reads the battles' short ids in one `battleLinks`
  read while planning the run.
- **No preview, two ways.** The link is a masked link around an
  angle-bracketed address, `[Open in Elixir](<url>)`, on its own line
  after the words, the form Discord never unfurls; and the relay already
  sends every webhook post and edit with `flags: 4` (SUPPRESS_EMBEDS,
  `packages/clan/src/discord-webhook.mjs`), now pinned for edits too.
- **Both modes.** Elixir's own words and the clan's model's words go
  through the same `postContent`, which appends the link after the
  engine's checks. The checks already refuse any link in the model's own
  words (`editorProblem`: a bare address, an angle-bracketed one, a bare
  domain, a markdown link), so a refused post falls back to Elixir's
  words and the post's one address is Elixir's. Tests in
  `packages/syndication/test/clan-sync.test.mjs` pin each case.
- **Unchanged:** which events post, who is named, edits in place (an
  edit rebuilds the content with its link), skips (never posted, no
  link), and the leaders-only Actions channel, whose posts already carry
  the Actions link in angle brackets with embeds suppressed.

Docs: The clan's activity in Discord. MCP and JSON API unchanged.
