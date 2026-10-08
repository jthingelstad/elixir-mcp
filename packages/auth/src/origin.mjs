/**
 * Proof that a request came THROUGH CloudFront rather than straight at the
 * API Gateway origin. The distribution attaches a shared secret as a custom
 * origin header; a caller who found the execute-api hostname cannot. Without
 * it, a direct hit could forge cloudfront-viewer-address and poison the
 * viewer_ip columns in mcp_call_audit and credential_refusal.
 *
 * Unset secret = the check is off (local development and tests). Set it and
 * every request must carry it; the comparison is constant-time.
 *
 * `secret` may be `[current, previous]` (#71):
 * CloudFront sends the current one, and during a rotation some edges
 * still send the previous one for the minutes the distribution takes to
 * deploy, so the doors accept either (ORIGIN_SECRET_PREVIOUS).
 */

import { timingSafeEqual } from "node:crypto";

export const ORIGIN_HEADER = "x-elixir-origin";

export function originAllowed(event, secret) {
  const secrets = [secret]
    .flat()
    .filter((s) => typeof s === "string" && s.length > 0);
  if (secrets.length === 0) return true;
  const presented = String(
    event?.headers?.[ORIGIN_HEADER] ??
      event?.headers?.[ORIGIN_HEADER.toUpperCase()] ??
      "",
  );
  const a = Buffer.from(presented);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export const forbiddenOrigin = () => ({
  statusCode: 403,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ error: "forbidden_origin" }),
});

/**
 * The caller's own address. The Lambda's
 * requestContext.http.sourceIp is the CloudFront edge node that forwarded
 * the request, shared by everyone behind that edge. The viewer's address arrives in cloudfront-viewer-address
 * ("1.2.3.4:53422", IPv6 as "2001:db8::1:53422" or bracketed), forwarded
 * by every door behavior's origin request policy and trustworthy because
 * originAllowed proves the request came through CloudFront. The port is
 * noise. Without the header (a direct hit in local development) this is
 * null: a limit keys on `viewerIp(event) ?? "unknown"`, never on the edge.
 */
export function viewerIp(event) {
  const headers = event?.headers ?? {};
  const raw = String(
    headers["cloudfront-viewer-address"] ??
      headers["CloudFront-Viewer-Address"] ??
      "",
  ).trim();
  if (!raw) return null;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 1 ? raw.slice(1, end) : null;
  }
  const colon = raw.lastIndexOf(":");
  return (colon > 0 ? raw.slice(0, colon) : raw) || null;
}
