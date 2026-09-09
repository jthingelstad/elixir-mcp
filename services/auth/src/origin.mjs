/**
 * Proof that a request came THROUGH CloudFront rather than straight at the
 * API Gateway origin. The distribution attaches a shared secret as a custom
 * origin header; a caller who found the execute-api hostname cannot. Without
 * it, a direct hit could forge cloudfront-viewer-address and poison the
 * viewer_ip columns in mcp_call_audit and credential_refusal.
 *
 * Unset secret = the check is off (local development and tests). Set it and
 * every request must carry it; the comparison is constant-time.
 */

import { timingSafeEqual } from "node:crypto";

export const ORIGIN_HEADER = "x-elixir-origin";

export function originAllowed(event, secret) {
  if (!secret) return true;
  const presented = String(
    event?.headers?.[ORIGIN_HEADER] ??
      event?.headers?.[ORIGIN_HEADER.toUpperCase()] ??
      "",
  );
  const a = Buffer.from(presented);
  const b = Buffer.from(String(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const forbiddenOrigin = () => ({
  statusCode: 403,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ error: "forbidden_origin" }),
});
