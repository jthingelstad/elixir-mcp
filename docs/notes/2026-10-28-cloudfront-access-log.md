# 2026-10-28 — CloudFront access logs in CloudWatch for 24 months

Jamie, 2026-10-28: "Approved: build CloudFront logging for all
distributions ... per-repo PRs", with a retention of "24 months".

**What.** The `elixir.poapkings.com` distribution now also sends
CloudFront standard logging v2 to the CloudWatch Logs group
`/elixir-mcp/web-access`, kept 731 days (the CloudWatch value for 24
months), in the same shape as the other sites' `/<site>/web-access`
groups: `timestamp(ms)`, `cs-method`, `cs-uri-stem`, `sc-status`,
`sc-bytes`, `sc-range-start`, `sc-range-end`, `cs(User-Agent)` and
`x-edge-result-type`. No client IP, no query string (OAuth codes and
states travel there), no cookies, no referrer. Four stack resources:
`WebAccessLogGroup`, `WebAccessLogSource`, `WebAccessLogDestination`,
`WebAccessLogDelivery`; `infra-controls.test.mjs` holds the group,
retention and field list.

**Unchanged.** The legacy standard log to S3
(`elixir-mcp-edge-logs-<account>`, prefix `cloudfront/`, 30-day
lifecycle, which does carry the client IP and query string) keeps
running beside it. Retiring it is a separate change. MCP and JSON API
unchanged.
