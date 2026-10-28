# 2026-10-28 — The legacy S3 edge log is retired

Jamie, 2026-10-28, approved retiring it ("okay"), after
`2026-10-28-cloudfront-access-log.md` put the distribution's access log
in CloudWatch.

**What.** The `elixir.poapkings.com` distribution no longer writes the
legacy CloudFront standard log to S3 (`elixir-mcp-edge-logs-<account>`,
prefix `cloudfront/`), which carried each request's client IP and query
string. Its only access log is now the IP-free standard logging v2
delivery to `/elixir-mcp/web-access` (731 days). The `Logging` block is
gone from `SiteDistribution`, and `infra-controls.test.mjs` holds it gone.

**The bucket.** `EdgeLogBucket` held nothing but these logs. It stays in
the stack for now: it is unversioned, so its 30-day lifecycle empties it
by 2026-11-28, and a later change then removes the resource so
CloudFormation deletes an empty bucket. Nothing is emptied or deleted by
hand (#655).

MCP and JSON API unchanged.
