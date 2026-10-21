# 2026-10-21 — {profile_read}: the status page and the stats snapshot can be explained

The platform review (2026-10-21, §2 and §3) found `/api/public/status`
at p50 1.0 s and p95 4.6 s over 694 calls in seven days, and three of
the four heaviest recurring statements in the Postgres slow log in two
reads that are not tools: the status door's collector query (50 runs
over 1 s, p50 3.6 s) and the hourly `public_stats` snapshot (its totals,
184 runs, p50 1.9 s; its daily fetch series, 186 runs, p50 1.7 s).
`{profile_tool}` explains tools only, and "Live diagnostics only
through migrate ops" (DECISIONS) leaves no other way to see their plans.

- The status read moves, unchanged, from `services/web-api` into
  `packages/tools/src/public-status.mjs` (`readPublicStatus`), beside
  `public-stats.mjs`; the door keeps the response and its 60 s cache
  header. Same SQL, same fields; `@elixir-mcp/tools` now depends on
  `@elixir-mcp/collector-door` for the signed-release expression.
- `{profile_read}` (`{"profile_read": {"read": "public_status" |
  "public_stats", "explain": true}}`) runs either package function
  through `{profile_tool}`'s recording db in a read-only session: every
  query timed and, with `explain`, each read's plan, slowest first. The
  status read's dead-letter count is an S3 read and is left out.

No migration, no contract or JSON API change (MCP 11.13.3, JSON API
3.2.0). The fixes these plans inform follow in their own change.
