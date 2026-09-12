/**
 * Compact HMAC session tokens (librarian's session.mts logic, secret
 * injected — no env reads here). Tokens verify statelessly; the DB
 * session row (sessions-store.mjs) is the revocation authority.
 *
 * Signing canonicalizes by sorting top-level ENTRIES, not via a stringify
 * replacer array — a replacer array also filters keys of nested objects
 * and would silently drop a future nested claim from the signed bytes
 * (librarian's shipped lesson, kept verbatim).
 */

import crypto from "node:crypto";

// Sliding 30 days (was 9 until 2026-09-12): a person who is away for a
// week and a half is not a person who should have to sign in again. The
// absolute cap below is the security bound; the sliding window is only
// ever the "you stopped using it" bound, and nine days was shorter than
// an ordinary holiday.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
// The signed token and cookie last to the ABSOLUTE cap; the DB row -
// checked on every request - is the sliding + revocation truth. A
// token whose exp matched the sliding window made "sliding" a fixed
// 9-day ceiling (sol-6 finding): the row slid, the cookie died.
export const ABSOLUTE_CAP_DAYS = 90;

/**
 * The one session cookie, and the one place its attributes are written.
 * Two origins set it now - the site API at sign-in and the MCP door at
 * OAuth consent (2026-09-12) - and they must agree on every attribute
 * or the second Set-Cookie is a different cookie to the browser.
 */
export const SESSION_COOKIE_NAME = "__Host-elixir_session";

export function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/** The session token out of an API Gateway v2 event, or "". */
export function readSessionCookie(event) {
  const cookies =
    event.cookies ?? String(event.headers?.cookie ?? "").split("; ");
  for (const c of cookies) {
    if (c.startsWith(`${SESSION_COOKIE_NAME}=`))
      return c.slice(SESSION_COOKIE_NAME.length + 1);
  }
  return "";
}

/**
 * What a session row remembers about the browser holding it, for the
 * Profile page's device list: a short client label from the user agent
 * (never the raw string), the viewer address CloudFront saw, and its
 * country. Missing headers are null, never "unknown" strings the page
 * would then have to special-case.
 */
export function sessionSeenFrom(event) {
  const headers = event?.headers ?? {};
  const address = String(headers["cloudfront-viewer-address"] ?? "");
  // "1.2.3.4:56789" or "[2001:db8::1]:56789"; the port is noise.
  const from = address
    ? address.startsWith("[")
      ? address.slice(1, address.indexOf("]"))
      : address.replace(/:\d+$/, "")
    : null;
  const country = String(headers["cloudfront-viewer-country"] ?? "") || null;
  return { client: clientLabel(headers["user-agent"]), from, country };
}

/** "Safari on iPhone", "Chrome on Mac", "Firefox on Windows"... or null. */
export function clientLabel(userAgent) {
  const ua = String(userAgent ?? "");
  if (!ua) return null;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  if (!browser && !os) return "Other";
  return browser && os ? `${browser} on ${os}` : (browser ?? os);
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function b64urlDecode(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(value + padding, "base64url");
}

export function signPayload(secret, payload) {
  const canonical = Object.fromEntries(
    Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const encoded = b64url(JSON.stringify(canonical));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function createSessionToken({
  secret,
  sub,
  sessionId,
  now = Date.now(),
}) {
  const sid = sessionId ?? crypto.randomBytes(18).toString("base64url");
  const iat = Math.floor(now / 1000);
  const exp = iat + ABSOLUTE_CAP_DAYS * 86400;
  return {
    sessionId: sid,
    expiresAt: exp,
    slidingExpiresAt: iat + SESSION_TTL_SECONDS,
    token: signPayload(secret, { sid, sub, iat, exp }),
  };
}

export function verifySessionToken({ secret, token, now = Date.now() }) {
  try {
    const [encoded, signature] = String(token ?? "").split(".", 2);
    if (!encoded || !signature) return null;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(encoded)
      .digest();
    const supplied = b64urlDecode(signature);
    if (
      expected.length !== supplied.length ||
      !crypto.timingSafeEqual(expected, supplied)
    )
      return null;
    const payload = JSON.parse(b64urlDecode(encoded).toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return null;
    if (Number(payload.exp ?? 0) < Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
