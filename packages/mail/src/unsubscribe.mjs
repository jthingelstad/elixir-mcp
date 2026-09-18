/** The one-click unsubscribe token.
 *
 *  Gmail and Yahoo POST the List-Unsubscribe URL with no cookie, so the
 *  token is the whole credential: HMAC-SHA256 over (account_id, kind,
 *  issued_at) under the app's session secret with a domain separator,
 *  base64url, long-lived (the header is read weeks after the send) and
 *  revoked only by rotating the secret. `kind` may be "all". The
 *  footer link is a GET to a page with a button that POSTs; a GET that
 *  changed state would unsubscribe everyone whose link scanner
 *  prefetched it. */
import { createHmac, timingSafeEqual } from "node:crypto";

const DOMAIN = "elixir-mcp:email-unsubscribe:v1";
const SITE = "https://elixir.poapkings.com";

function mac(secret, payload) {
  return createHmac("sha256", secret).update(`${DOMAIN}\n${payload}`).digest();
}

export function signUnsubscribe({
  secret,
  accountId,
  kind,
  issuedAt = Date.now(),
}) {
  if (!secret) throw new Error("unsubscribe: no secret");
  const payload = `${accountId}\n${kind}\n${Math.floor(issuedAt / 1000)}`;
  const sig = mac(secret, payload).toString("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

/** {accountId, kind, issuedAt} or null. */
export function verifyUnsubscribe({ secret, token }) {
  if (!secret || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  let payload;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  const want = mac(secret, payload);
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return null;
  const [accountId, kind, issued] = payload.split("\n");
  if (!accountId || !kind || !/^\d+$/.test(issued ?? "")) return null;
  return { accountId, kind, issuedAt: Number(issued) * 1000 };
}

export function unsubscribeUrl(token) {
  return `${SITE}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}
