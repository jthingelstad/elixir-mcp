/**
 * Which rows of the call log (`mcp_call_audit`) are MCP calls. Since
 * 2026-11-28 nothing else writes one (Jamie: the site's own reads "should
 * not be logged in the database"). The website's reads (surface `web`) and
 * `GET /api/v1/me` (`rest`) wrote rows before then; they age out with the
 * log's 28 days, the last on 2026-12-26, so this filter can go after
 * 2026-12-27. No row is deleted for it. Every MCP call is one the daily
 * tool-call limiter charges (`mcpday#`, packages/tools quota.mjs); Clan's
 * reads never wrote a row (2026-11-13).
 */
export const mcpCalls = (alias = null) =>
  `coalesce(${alias ? `${alias}.` : ""}surface, '') not in ('rest', 'web')`;
