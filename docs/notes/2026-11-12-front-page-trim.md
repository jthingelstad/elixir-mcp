# 2026-11-12 — The front page: the gate, three rows and a Drop line

Jamie, 2026-11-12: "Approved: trim the signed-out front page to the gate,
three flat rows and a Drop line, moving the agent demo and counts to Docs
and Status".

- **The front page** (`apps/site/src/index.njk`) keeps the gate from #790 as
  it was. Below it, five boxed tiles, Drop's banner, the agent exchange, the
  four count tiles and the boxed call to join gave way to three flat rows
  (friends, your clan, highlights), one line for Drop and a flat call to
  join. The rows name only what is live: following, the feed, cheers and the
  digest; the race, standings, rules and leaders' Run; the clan directory;
  highlights and their open share link. Near you is not live and is not
  named.
- **The agent exchange** moved to Connect a client
  (`/docs/connect-a-client`), drawn by the docs layout from the page's
  `demo: true` (`_includes/doc-demo.njk`), not from its Markdown: the docs
  corpus and llms-full.txt render the Markdown alone, and an agent has no
  use for a typing window. "On this page" lists it first. Its **Connect
  your agent** link now jumps to the page's own steps (`#connect`).
- **The counts** were already on Status and data (`/data`, "The record,
  counted"), with daily player records besides, so nothing was added there.
  The sitemap's lastmod no longer dates `/` by the stats snapshot, and dates
  Connect a client by the examples the exchange is drawn from.
- The CSS for the tiles, Drop's banner and the long-gone card strip left
  `packages/design`. DECISIONS "Signed out: sign in or join" carries the
  ruling.

MCP and JSON API unchanged.
