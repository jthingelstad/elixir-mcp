# 2026-10-21 — The edge and the database connections

Items 4 to 6 and the edge items of the 2026-10-21 platform review, which
Jamie approved as a whole. Baselines were read live before the change; the
deploy's pull request comment and the session report carry the readings
after it.

**Connections (`packages/http/src/database.mjs`).** The door pools closed
an idle connection after 30 s. In the week to 10-21, 1,753 of web-api's
2,829 routed requests (62%) logged `connect_ms` of 10 ms or more, about
51 ms on average, which is a fresh connection's TLS and authentication.
Idle connections are now kept 240 s, under the 300 s lifetime, with TCP
keepalive after a minute. Nothing on the path closes one sooner: the
instance sets no `idle_session_timeout`, and the network connector
documents no idle limit. The longer life can hold a few more backends on
the micro; `DatabaseConnections` and `FreeableMemory` are read after the
deploy.

Every returned lease sent `ROLLBACK` before `DISCARD ALL`, and Postgres
logged `there is no transaction in progress` for each: 31,519 of the
log's 32,342 lines in the 24 hours to 10-21. Cleanup now rolls back only
when the server's last ReadyForQuery reports a transaction. `DISCARD ALL`
refuses to run inside one, so a wrong status destroys the client rather
than returning it dirty. Scratch tests pin a session `SET`, a temporary
table, an advisory lock, a transaction left open, a failed transaction,
and no notice on the common path.

**A connection that cannot be had.** web-api let a full pool or a refused
connection escape to the server's generic 503 (`{"error":"unavailable"}`,
no `Retry-After`, no request id), which on `/api/v1` contradicted
`integrations.md`. It now answers `temporarily_unavailable` as a problem
with `Retry-After: 5` on `/api/v1`, and `unavailable` with a message, a
request id and `Retry-After: 5` on the site API, as MCP's
`live_unavailable` does. `/api/clan/health` and the retired callback take
no lease.

**Edge.** Every cache behaviour now compresses (ten private ones did
not). CloudFront compresses only for a viewer that asks, and only
compressible types between 1 KB and 10 MB. The Go collector sets no
`Accept-Encoding`, so Go's transport asks for gzip and decompresses
transparently; it hashes no response bytes, and release signatures are
checked over downloaded files, not door responses. `/.well-known/*` moves
to CachingOptimized with no origin request policy: the OAuth metadata
documents are built from the issuer and the path, say `max-age=300`, and
a test pins that a credential or cookie changes nothing. They now answer
HEAD as well as GET.

**Misses (#451).** 728 site misses reached web-api in the week to 10-21.
The static router answers scanner paths 404 itself: dot-files,
server-side code and configuration extensions, `wp-*`, `phpinfo` and
similar directories, and config and secret file names. That covers 425
of them. The site test walks every built file, as typed, encoded and as a
page, so no real path can match. `/favicon.ico` (67) and
`/apple-touch-icon-precomposed.png` (17) are now files of the site, made
from the touch icon.

No contract moves, MCP or JSON API (3.2.0): the 503 is the one `integrations.md` documents.
