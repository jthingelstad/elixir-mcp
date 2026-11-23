# 2026-11-23 — CloudFront keeps each private RSS feed for one hour

The owner asked for the per-account RSS feed to be cached at CloudFront:
"can easily be cached for 2-4 hours per user". It is now kept for one
hour.

What changed:

- **`RssFeedCachePolicy`** (`elixir-mcp-rss-feed`), a cache policy of its
  own for the `/api/rss/*` behaviour: MinTTL 0, DefaultTTL 0, MaxTTL 3600,
  gzip and brotli, and a key of the path alone (no header, cookie or query
  string). The token is the path, so one copy serves one link and a copy
  is never shared across links. `/api/*` and every other behaviour keep
  `WebPrivateCachePolicy`.
- **The origin request policy stays `McpOriginRequestPolicy`.** It sends
  no cookie, so a conditional request still reaches the origin on a miss.
  What it forwards (every query string, `origin`, `content-type`, the
  viewer's address and country) goes to the origin on a miss only and is
  not in the cache key, so it splits nothing; the feed reads none of it.
  The cache policy no longer forwards `Authorization` on this behaviour.
- **The 200 and 304 send `cache-control: public, max-age=300,
  s-maxage=3600`.** CloudFront keeps the hour (s-maxage, capped by
  MaxTTL); the reader keeps five minutes, as before. No
  stale-while-revalidate. The 404 (a wrong, reset or turned-off token) and
  the 429 (the hour's cap) stay `no-store`.

Why one hour and not two to four: the saving beyond an hour is small for a
reader polling every 15 minutes or so, and the hour bounds how long a
reset link, a turned-off feed, a closed account, a removed post or a block
can linger at the edge. There is no invalidation machinery and no IAM
change: an invalidation on reset would need the deploy role's
`cloudfront:CreateInvalidation` from a Lambda, and the token would reach
the invalidation path.

What else moves when the edge answers:

- **The 60-an-hour cap** counts only the reads that reach Elixir: misses
  and the edge's revalidations. An edge hit is never counted. The cap
  still bounds the work one link can cause.
- **The request line's `conditional`** is seen only on what reaches the
  origin. On a revalidation it is CloudFront's own `If-None-Match` (the tag
  it holds), not the reader's.
- **Nothing records "last polled"** for the feed owner (Settings ›
  Connections & agents shows only when the link was made), so nothing
  undercounts. The request log does: it no longer sees every poll.
- **Promises reworded** to the hour: the Settings confirms (Reset, Turn
  off), What members see ("Only you, or nobody"), the RSS section of `/docs/timeline`, and the
  code comments that said "at once". Elixir itself still refuses a reset
  or removed token at once; the edge's copy is what lasts.

CloudFront behaviour this relies on, from its developer guide: an object
past its TTL is revalidated with `If-None-Match` carrying the stored ETag,
and an origin 304 refreshes it; a weak ETag from the origin is passed
through unchanged when compressing; 429 is not a status CloudFront
caches. Not confirmed in the guide, to check live after the deploy:
that a reader's `If-None-Match` on an edge hit is answered 304 from the
cached copy, what CloudFront does with a reader's `If-None-Match` on a
plain miss (forward it, so the origin's 304 leaves nothing cached, or
fetch the whole feed), and whether a 404 marked `no-store` is still kept
for the default 10-second error caching minimum.

The privacy page says a deleted post goes "at once, here and from any page
of Elixir's"; with the edge copy, an RSS reader may hold it up to an hour.
Policy pages change only with Jamie's word, so that line is left for him.

MCP and JSON API unchanged. No migration.
