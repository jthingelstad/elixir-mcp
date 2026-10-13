# 2026-10-13 — Clan native session failures keep their retry page

PR #571 review caught an initial Clan session failure path before the native
HTTP cutover. A failed primary session check now seeds Clan's unavailable
envelope without another database read. Clan-specific 5xx responses and thrown
reads also render the existing retry callout, with HTTP 503 and private,
no-store caching. Three regression cases cover those independent failures.

MCP 11.13.0 and JSON API 3.2.0 unchanged. No additional acceptance scope: this
correction ships with the Web Functions migration's shared transport acceptance.
