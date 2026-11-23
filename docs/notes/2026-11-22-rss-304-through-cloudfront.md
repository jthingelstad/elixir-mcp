# 2026-11-22 — The RSS feed's 304 never reached a reader: CloudFront dropped the header

After #1188 and #1191 went live, the one feed reader polling production got
a 200 on five polls in a row, each within a few bytes of the last, and
never a 304. The polls were fast (106 to 144 ms, from about 900 ms), so the
stored week was doing its part; the validator was not.

## The cause

`/api/rss/<token>.xml` was served by the `/api/*` behaviour, whose origin
request policy forwards every cookie. CloudFront's developer guide says, under
"Conditional requests" for custom origins: `If-Modified-Since` and
`If-None-Match` conditional requests are not supported when CloudFront is
configured to forward cookies. So the reader's `If-None-Match` never
reached the origin, and the route answered every poll in full.

## The change

`/api/rss/*` is a behaviour of its own, ahead of `/api/*`: GET and HEAD
only, the private cache policy, and the no-cookie origin request policy the
MCP door and `/api/v1` already use. The feed never needed a cookie: its
token is in the path. `/api/me/rss`, the link's settings, needs the
session and stays on `/api/*`. `services/mcp/test/infra-controls.test.mjs`
pins both.

## The tag across a rebuild

Before finding the cause I checked the other way a 304 could fail. A reader
polls about every fifteen minutes and each poll past the stored row's fresh
window wakes a rebuild, so nearly every poll reads a build newer than the
last one. The test from #1188 only held the tag steady across two reads of
one build. A new test in `services/web-api/test/cheers-rss.test.mjs` polls,
drops the stored row, moves the clock twenty minutes on, and polls again:
the document apart from its `lastBuildDate`, the tag, and the 304 for the
first poll's tag all hold. It passed as written; it stays as the pin.

## What is proven and what is not

The repository's tests prove the route and the template. That CloudFront
then passes the header is AWS's documented behaviour, and is read back
after the deploy from the web API's log: a 304 on `GET /api/rss/*` once the
reader polls an unchanged week.

MCP and JSON API unchanged. No migration.
