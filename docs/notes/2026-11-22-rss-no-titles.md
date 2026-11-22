# 2026-11-22 — RSS items without titles

Jamie, 2026-11-22, from a phone reader: the private RSS feed repeated each
item's title ("Name: line") in its body, and the line already names its
player. "You can have no titles or we need to make the titles something
useful."

## What changed

- `renderRss` (`services/web-api/src/feed-link.mjs`) writes no `<title>`
  on an item. RSS 2.0 needs a title or a description, not both; readers
  show an untitled item as a post.
- Each item with a player or clan carries `<dc:creator>` with that game
  name (the Dublin Core namespace is declared on `<rss>`), which readers
  show as the author.
- A post is the writer's own words and never names them, so its
  description leads with the name: "Name: words", or "Name asked: words"
  for a question. A question with no writer known leads "Question: ".
- The channel keeps its title.

MCP and JSON API unchanged; no migration.

## [engineering] decisions

- No title rather than a made-up headline: any short title (the kind, the
  player alone) either repeats the line or says less than it.
