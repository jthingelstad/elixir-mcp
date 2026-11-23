# 2026-11-23 — Product updates in everyone's Timeline

Jamie: "I've been thinking we need a way to send a message into all Users
timelines for product updates." What's new is already where product
changes are written, one file per entry, in the pull request that ships
the change. Now one of those entries can be marked so it appears in every
signed-in person's Home Timeline.

## Authoring

`<!-- timeline -->` alone on a timed entry's first line, above the title.
An HTML comment, so a renderer that ever saw it would draw nothing, and
the reader (`apps/site/src/_lib/updates.mjs`, `parseUpdate`) strips it
before anything else reads the entry: the site, the feeds and
`elixir_updates` never see it. Entries have no frontmatter, and the mark
keeps it that way. A mark anywhere else in the file is refused, and only
a timed entry (`t<HHMMSS>`) can be marked, since its time places the
story. The same reader refuses a marked entry whose first paragraph,
as plain text, is over 400 characters, so the Timeline never cuts one.
The rule for marking is in `apps/site/AGENTS.md` ("Updates") and the
`ship` skill: a change a person using the app would notice and want to
know; never one only agents or operators see; rarely more than one or two
a week.

The entry's page address moved into the same reader (`updateSlug`), which
`updatesView.js` and the Timeline both use, so the link and the page
cannot disagree.

## The data's path

1. `packages/docs/build.mjs` (run by the root `npm run build`, before
   tests and bundles) already reads What's new through the site's reader
   for the corpus. It now also writes `dist/timeline-updates.json`: the
   marked entries only, each `{ id, at, title, lede, path }`, a few hundred
   bytes. Not the corpus: that is over a megabyte, and Home reads this on
   every feed page.
2. `packages/docs/src/timeline.mjs` reads it on first use; esbuild inlines
   it into the web API bundle, in a lazy chunk.
3. `services/web-api/src/product-updates.mjs` turns the entries inside a
   window into feed items. `index.mjs` hands its reader to the handler
   (`productUpdates`); the handler's default is none, so tests choose
   their own entries and the real ones never leak into an unrelated
   test's counts.
4. `routes/home.mjs` `readFeed` merges them into the week beside the live
   posts, over the same window (`week.fromMs` to now), for a person's feed
   only, before the pages are cut. Chips, cheers and comments run over the
   other items only (`besideProductUpdates`).

The web app's main chunk did not move; `FeedItem`'s lazy chunk grew by
about 750 bytes for the component that draws one.

## What a person sees

A story from Elixir (the app's name and its mark in the round, no player
or clan), its title, its first paragraph whole and **Read more** to its page
under `/updates`. It sits by its own UTC time and stays as long as the
feed's week holds it, the same for everyone, accounts made after it
included. It is under **Everyone** and **All modes** only (`groupsOf` gives
it no chip; `KIND_MODES` names it about no mode), and never under
**Questions**.

## What it is not

Never stored: not in `home_feed`, not in `timeline_story`, so the stored
Timeline's shadow never meets one. The later stages can move this source
by moving the one call in `readFeed`. Not in the bell, push, the digest,
Discord, the RSS feed of the Timeline, MCP `elixir_timeline`, a player's
page or a clan's feed. No cheers or comments: both key on stories the
record or a post owns (`cheerable`, `targetsForItems`), and an update is
neither. The "N new" pill counts stored items and live posts, so an update
does not move it, and the first page's watermark leaves updates out so it
never passes over a stored item. A mode filter's `week_total` counts it.

## Easy later

- **The bell:** a bell entry per update from the same file, read beside
  `bell.mjs`'s week; it would need a per-account seen mark so it rings
  once.
- **Push:** a send per account at deploy time, which means a job and an
  audience; not a read, so more than a merge.
- **The digest mail:** a line from the same file inside the mail's week
  (`packages/mail`), the cheapest of the four, since it is a read.
- **The N new pill:** add the count of updates newer than `since` to
  `GET /api/me/home/feed/new`, and drop the watermark filter.
- **MCP `elixir_timeline`:** not wanted while `elixir_updates` serves
  agents; it would also move the tool's fingerprint.
- **Cheers:** possible only with a target the cheer tables accept, which
  an update has none of today.

Ships with the first marked entry,
`apps/site/src/_data/updates/2026-11-23-t151929-news-in-your-timeline.md`.
No migration, no MCP or `/api/v1` change.
