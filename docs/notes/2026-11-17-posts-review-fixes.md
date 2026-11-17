# 2026-11-17 — Posts: Codex's two findings on #1100

Both were real, and both are fixed here.

- **Clan's Feed sent posts with no cheers or comments.** A clanmate may
  cheer a post and read its answers there, but the card drew neither.
  `readClanFeed` now adds the reader's cheers and comments to its posts
  (`withCheers`, `withComments`), and to nothing else: other Feed items
  still take no cheer. Pinned in `services/web-api/test/posts.test.mjs`.
- **A cheer on a page's post list did not redraw.** `useCheer` wrote only
  Home's feed, so on Profile or a player page the tap showed nothing, and
  a second tap sent the same cheer again. A post list now passes its own
  cache to its cards (`FeedItem`'s `cheerWhere`), as Clan's Feed does.
  A confirmed cheer also reaches every post list (`["me", "posts"]`) and
  Clan's feeds. `mapItems` reads Clan's whole envelope. Pinned in
  `apps/web/test/posts.test.jsx`.
