# 2026-11-23 — The request line says when a request was conditional

The web doors' request line (`event: "http_request"`,
`packages/http/src/server.mjs`) gains one field, present only when it is
true: `conditional: true` for a request that carried `If-None-Match`. The
tag itself is never logged.

Why: after #1193 gave the RSS link a cookie-free CloudFront behaviour, the
reader's first poll was still a 200, and nothing recorded could say why.
The edge log keeps no request headers and the origin logged none, so a 200
from a changed feed, a reader that sends no tag and an edge that drops the
header all looked the same. With the field, a poll's line says which: a 200
with `conditional` is a feed that changed; a 200 without it is a request
that reached the origin with no tag. A probe with an invented token
(a 404, behind the token check) shows whether the edge passes the header
at all, with no real link needed.

The latency report's query and the metric filters read `http`, `status`
and `ms` and are unchanged. MCP and JSON API unchanged. No migration.
