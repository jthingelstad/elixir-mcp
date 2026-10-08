/** The one-click unsubscribe token.
 *
 *  Gmail and Yahoo POST the List-Unsubscribe URL with no cookie, so the
 *  token is the whole credential: HMAC-SHA256 over (account_id, kind,
 *  issued_at) with a domain separator, base64url, long-lived (the header
 *  is read weeks after the send). `kind` may be "all". The footer link is
 *  a GET to a page with a button that POSTs; a GET that changed state
 *  would unsubscribe everyone whose link scanner prefetched it.
 *
 *  The key (#71). Links were signed with the
 *  session secret, so rotating it would have signed everyone out and
 *  broken every link already sent. A link now names its key: `u1.` plus
 *  the token is signed with the unsubscribe key of its own
 *  (UNSUBSCRIBE_SECRET, the app secret's `unsubscribe_secret`), and a
 *  token with no key id is the older kind, checked against the session
 *  secrets (SESSION_SECRET, then SESSION_SECRET_PREVIOUS). Until the app
 *  secret carries its own key, links are still signed the older way.
 *
 *  `secret` is a keyring, `{ unsubscribe, session }` (`session` one
 *  secret or `[current, ...previous]`), or a string, which is the session
 *  secret alone. */
import { createHmac, timingSafeEqual } from "node:crypto";

const DOMAIN = "elixir-mcp:email-unsubscribe:v1";
const SITE = "https://elixir.poapkings.com";

/** The key id a link signed with the unsubscribe key carries. */
export const UNSUBSCRIBE_KEY_ID = "u1";

function mac(secret, payload) {
  return createHmac("sha256", secret).update(`${DOMAIN}\n${payload}`).digest();
}

const present = (v) => typeof v === "string" && v.length > 0;

function keyringOf(secret) {
  if (secret && typeof secret === "object" && !Array.isArray(secret))
    return {
      unsubscribe: present(secret.unsubscribe) ? secret.unsubscribe : null,
      session: [secret.session].flat().filter(present),
    };
  return { unsubscribe: null, session: [secret].flat().filter(present) };
}

export function signUnsubscribe({
  secret,
  accountId,
  kind,
  issuedAt = Date.now(),
}) {
  const keys = keyringOf(secret);
  const key = keys.unsubscribe ?? keys.session[0];
  if (!key) throw new Error("unsubscribe: no secret");
  const payload = `${accountId}\n${kind}\n${Math.floor(issuedAt / 1000)}`;
  const sig = mac(key, payload).toString("base64url");
  const token = `${Buffer.from(payload).toString("base64url")}.${sig}`;
  return keys.unsubscribe ? `${UNSUBSCRIBE_KEY_ID}.${token}` : token;
}

/** {accountId, kind, issuedAt} or null. */
export function verifyUnsubscribe({ secret, token }) {
  if (typeof token !== "string") return null;
  const keys = keyringOf(secret);
  const parts = token.split(".");
  let candidates, body;
  if (parts.length === 3 && parts[0] === UNSUBSCRIBE_KEY_ID) {
    candidates = keys.unsubscribe ? [keys.unsubscribe] : [];
    body = parts.slice(1);
  } else if (parts.length === 2) {
    candidates = keys.session;
    body = parts;
  } else return null;
  if (!body[0] || candidates.length === 0) return null;
  let payload;
  try {
    payload = Buffer.from(body[0], "base64url").toString("utf8");
  } catch {
    return null;
  }
  const given = Buffer.from(body[1], "base64url");
  const signed = candidates.some((key) => {
    const want = mac(key, payload);
    return given.length === want.length && timingSafeEqual(given, want);
  });
  if (!signed) return null;
  const [accountId, kind, issued] = payload.split("\n");
  if (!accountId || !kind || !/^\d+$/.test(issued ?? "")) return null;
  return { accountId, kind, issuedAt: Number(issued) * 1000 };
}

export function unsubscribeUrl(token) {
  return `${SITE}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}
