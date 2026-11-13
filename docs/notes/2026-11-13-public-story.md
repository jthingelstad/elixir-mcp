# 2026-11-13 — The public story opens with the social layer

Copy only, for DECISIONS "The public story opens with the social layer"
(Jamie, 2026-11-12). The front-door sentence, "Elixir is the missing social
layer of Clash Royale: follow your friends and your clan, see how they
play, and cheer them on.", is now the first thing a newcomer reads about
Elixir on the signed-out front page (its lede, title and meta
description) and the docs home (its lede), and it is the app shell's meta
and Open Graph description, `site.js`'s description and tagline, the
`llms.txt` summary, the family page's Elixir entry, the README's opening
and the share card (`og-card.html`, re-rendered to `og.png` with no
change to its layout).

The Quickstart is rewritten as Home's four welcome steps (sign in, add
your player, follow a few people, choose your digest), each checked
against `apps/web/src/home/Today.jsx`, `logic.js` and
`services/web-api/src/first-answer.mjs`; its heading anchors moved, and
`docForwards.js` forwards `1-get-an-account` and `3-ask-something` (and
re-points `4-ask-something`) to the new places. About leads with
following and cheering, and moves the record, the collectors and MCP to
what feeds it. Two false claims went: the "Monday email" (Quickstart and
Recording; the digest is the one scheduled mail, Wednesdays by default)
and the docs home's "Wednesday email on how each of them did" framing of
Friends. "Elixir MCP" as the service's name in prose became "Elixir" in
the docs that said it to readers (not Architecture, which names the
repository).

The MCP server's `serverInfo.title` is "Elixir" (Jamie, 2026-11-13), in
`services/mcp/src/protocol.mjs` and the Protocol page's example; the
title is not part of the tool contract, so no contract bump.

Layout, class names and components are untouched, for the restyle
landing on the same pages. The privacy and terms pages needed no change:
neither says "track". MCP and the JSON API unchanged.
