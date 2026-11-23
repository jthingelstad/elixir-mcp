# 2026-11-22 — The request line names a route's shape, never a path's credential

The web doors' request line (`event: "http_request"`,
`packages/http/src/server.mjs`) logged the raw path, masking only an
agent's public id. A Timeline feed link's token is in its path
(`/api/rss/<token>`) and is the whole credential for a feed reader: the
database keeps only its SHA-256 so that reading the table never opens a
feed, and the log line undid that. A share link's id rode the same way.
`npm run web-latency` then printed what the lines held.

Now the web API tells the door which route answered
(`context.route`), and the line carries its shape: `GET /api/rss/*`. A
family route (Clan's `/api/clan/**`), the JSON API's one operation and a
path no route answered keep their path, masked by
`packages/http/src/log-path.mjs`: the segment after `rss`, `share` or
`shared-items`, and any long random segment, become `*`. So a `HEAD` on a
feed link, which no route answers, logs `HEAD /api/rss/*`.

`services/web-api/test/public-boundary.test.mjs` walks every wildcard
route the handler registers and requires its shape on the line, so a new
route's wildcard is never logged whatever it holds.
`normaliseRoute` in `infra/scripts/lib/web-latency.mjs` collapses the
same segments, for the lines written before this shipped.

Left as it is: CloudFront's access log (`/elixir-mcp/web-access`, kept
731 days) records `cs-uri-stem`, which CloudFront cannot mask. It holds
no client IP and is readable only inside the account. Lines already
written keep what they hold until their log group's retention ends (30
days for the web API's); a feed link is reset in Settings, and the old
token opens nothing from then on.

No migration, contract or JSON API change. No tool's answer moved, so
the deploy runs no acceptance family.
