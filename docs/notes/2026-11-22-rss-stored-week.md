# 2026-11-22 — The RSS feed reads Home's stored week

The private RSS feed (`GET /api/rss/<token>.xml`) built the reader's whole
week from the record on every poll. Over the seven days before this change
it answered 984 reads, every one a 200 with a full body, at a median of
906 ms and a p95 of 1,191 ms. A feed reader polls on a clock whether or not
anything happened, so nearly all of that work rebuilt a week the last poll
had already built.

## What changed

- **A poll is a select.** The feed reads Home's stored week (`home_feed`,
  the row Home serves) through `readFeedWeek`
  (`packages/tools/src/activity/home-feed.mjs`). The row is served as Home
  serves it: as is up to 15 minutes old, served and a background build
  asked for up to three hours old, built once and stored past that, or
  when the follow list or the time zone has changed.
- **What the feed may carry is decided at the read, never by what was
  stored.** Home's week is built for the app: it holds people lines and is
  read with leaders-only facts. The feed drops the row's people lines and
  its stored attested facts and highlights, then reads highlights and
  attested facts live as a reader outside the app (`windowFacts` takes
  `interactive`, false here), so no leaders-only fact can reach it whatever
  the row holds. Home's clan-story overlay is not applied: the feed keeps
  the game's words. The account's own administration was never in the
  stored week. Posts are read live on every poll, as before, with their
  block and report checks.
- **Measured in the budget test** (`signed-in-budget.test.mjs`, 56
  followed players): a poll over a stored week is 11 statements and 55
  shared buffers; the first poll, which builds Home's week once, is 36
  statements, inside Home's own built budget.
- **The item set is the one the old build made.** A test builds the week
  the old way and holds the feed to the same guids
  (`services/web-api/test/cheers-rss.test.mjs`); another gives a leader a
  leaders-only fact and a people line and holds both out of the feed while
  Home shows them (`packages/tools/test/feed-week.test.mjs`).
- **A poll is not a read of Home.** `read_at` is left alone, so a feed
  reader does not keep an account in the five-minute warm set. A poll past
  15 minutes asks for one background build through Home's own wake (one
  per account per quarter hour).
- **Conditional requests.** The response carries a weak `ETag` over the
  document without its `lastBuildDate`, and a poll whose `If-None-Match`
  names it gets `304` with no body. Weak because CloudFront compresses the
  response, which weakens a strong tag anyway. The token and the hour's
  cap are checked first, so a 304 says nothing a 200 would not, and a
  reset or turned-off link is a 404 whatever the request holds. No
  `Last-Modified`: an edit or a removal changes the items without moving
  any date a reader could compare.

## What a reader notices

Battles and sittings come from the stored week, so for someone who reads
only the feed they can arrive one poll later than before: a poll past 15
minutes serves the stored week and asks for a new one, which the next poll
reads. Someone who also opens the app gets the week Home keeps warm. Posts,
posts about battles and clan facts are current on every poll. Nothing is
lost, only later, and never more than three hours.

## Why this and not a new store

"Whether the timeline is stored is a performance choice" (DECISIONS) allows
a stored feed where computing on read cannot reach 2 s at p95. This stores
nothing new: it reads the row Home already keeps and stops building a
second copy of the same week beside it.

## What is left

The player page and `elixir_timeline` still compute their window from the
record on every read, inside their latency ceilings. The longer direction,
storing stories per player when an admission lands so that any reader's
feed is a select, is not started and is a design of its own.

MCP and JSON API unchanged. No migration.
