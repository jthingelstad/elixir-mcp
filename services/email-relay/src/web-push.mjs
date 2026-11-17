/**
 * Web push (2026-11-16, docs/notes/2026-11-16-web-push.md): the relay, the
 * one function with internet, sends the notices the jobs Lambda wrote to
 * the outbox's web-push/ lane, one object per notice and device.
 *
 * Written fresh from the standards, with no library: the payload is
 * encrypted for the device (RFC 8291, aes128gcm of RFC 8188) and the
 * request is signed with the VAPID key pair (RFC 8292).
 *
 * The VAPID pair lives in its own Secrets Manager secret,
 * `elixir-mcp/web-push` ({vapid_public_key, vapid_private_key}, base64url).
 * The private key is read here at runtime and kept in memory only: never
 * an environment variable, never a log line. The public key is checked
 * against the one the private key makes, so a mismatched pair sends
 * nothing rather than pushes every browser would refuse.
 *
 * What the relay answers goes back as a receipt on push-receipt/ (the
 * subscription and how it went, never the endpoint), which the timeline
 * sync reads into the database: a 404 or 410 deletes the subscription.
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { isPushEndpoint, isPushKind } from "@elixir-mcp/contracts";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => Buffer.from(String(s ?? ""), "base64url");

/** A record of 4096 bytes holds any notice Elixir sends. */
const RECORD_SIZE = 4096;
/** A push service's answer we wait for. */
const SEND_TIMEOUT_MS = 10_000;
/** How long a push service keeps a notice for a device that is off. */
const TTL_S = 6 * 3600;
/** The VAPID token's life: at most a day by RFC 8292; twelve hours. */
const VAPID_EXP_S = 12 * 3600;
/** Receives of one object before a push service's trouble is given up on
 *  (the email queue dead-letters at five; a lost push is not worth that). */
const PUSH_MAX_RECEIVES = 3;

/**
 * The payload encrypted for one device (RFC 8291 §3.4, one aes128gcm
 * record). `asKeys` and `salt` are for the standard's test vector only.
 */
export function encryptPayload(
  plaintext,
  { p256dh, auth },
  { asKeys = null, salt = randomBytes(16) } = {},
) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4)
    throw new Error("bad_p256dh");
  if (authSecret.length !== 16) throw new Error("bad_auth");
  const ecdh = createECDH("prime256v1");
  if (asKeys) ecdh.setPrivateKey(fromB64u(asKeys.private));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\0"),
      16,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const body = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]);
  if (body.length + 16 + 86 > RECORD_SIZE) throw new Error("payload_too_large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([
    cipher.update(body),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, sealed]);
}

/** The VAPID signer from the secret's pair; throws when the public key is
 *  not the private key's. Never logs either. */
export function vapidSigner({ vapid_public_key, vapid_private_key }) {
  const d = fromB64u(vapid_private_key);
  if (d.length !== 32) throw new Error("vapid_private_key_shape");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  if (!pub.equals(fromB64u(vapid_public_key)))
    throw new Error("vapid_keys_mismatch");
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: b64u(d),
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  const k = b64u(pub);
  return {
    publicKey: k,
    /** The Authorization header for one endpoint's origin. */
    authorization(endpoint, { subject, now = Date.now() }) {
      const aud = new URL(endpoint).origin;
      const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
      const claims = b64u(
        JSON.stringify({
          aud,
          exp: Math.floor(now / 1000) + VAPID_EXP_S,
          sub: subject,
        }),
      );
      const input = `${head}.${claims}`;
      const sig = sign("sha256", Buffer.from(input), {
        key,
        dsaEncoding: "ieee-p1363",
      });
      return `vapid t=${input}.${b64u(sig)}, k=${k}`;
    },
  };
}

/** The pair from Secrets Manager, read once per container and kept in
 *  memory. `getSecret()` returns the SecretString; a failed read throws so
 *  the record retries, and is read again next time. */
export function vapidFromSecret(getSecret) {
  let signer = null;
  return async () => {
    if (signer) return signer;
    const text = await getSecret();
    let pair;
    try {
      pair = JSON.parse(text);
    } catch {
      throw new Error("vapid_secret_shape");
    }
    signer = vapidSigner(pair);
    return signer;
  };
}

/** One web-push/ object, checked: what the jobs drain wrote. */
export function checkPushMessage(msg) {
  if (!msg || msg.v !== 1) return null;
  const { subscription_id, endpoint, p256dh, auth, notice } = msg;
  if (!/^\d{1,18}$/.test(String(subscription_id ?? ""))) return null;
  if (!isPushEndpoint(endpoint)) return null;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!notice || typeof notice !== "object") return null;
  const { notice_id, kind, title, body, url } = notice;
  if (typeof notice_id !== "string" || !/^[0-9a-f-]{36}$/.test(notice_id))
    return null;
  if (typeof kind !== "string" || !isPushKind(kind)) return null;
  if (typeof title !== "string" || !title || title.length > 120) return null;
  if (typeof body !== "string" || body.length > 200) return null;
  if (typeof url !== "string" || !/^\/(?!\/)/.test(url) || url.length > 300)
    return null;
  return {
    subscription_id: String(subscription_id),
    endpoint,
    p256dh,
    auth,
    notice: { notice_id, kind, title, body, url },
  };
}

/**
 * The web-push/ lane's worker: `(obj, {receives})`. Reads the object,
 * sends it, writes the receipt and deletes the object. A push service's
 * 429 or 5xx throws so the record retries, up to PUSH_MAX_RECEIVES; then
 * it is given up with a "failed" receipt. Off (`enabled` false) drops
 * every object unsent.
 */
export function createWebPushWorker({
  enabled,
  signer,
  subject,
  readObject,
  deleteObject,
  receipt,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  async function done(obj, out) {
    if (out) {
      try {
        await receipt(out);
      } catch {
        console.error("push_receipt_failed", "transport_error");
      }
    }
    try {
      await deleteObject(obj);
    } catch {
      console.error("outbox_delete_failed", "transport_error");
    }
  }

  return async function webPushObject(obj, { receives = 1 } = {}) {
    const text = await readObject(obj);
    if (text === null) return;
    let msg;
    try {
      msg = checkPushMessage(JSON.parse(text));
    } catch {
      msg = null;
    }
    if (!msg) {
      console.error("push_bad_message");
      await done(obj, null);
      return;
    }
    const base = {
      v: 1,
      subscription_id: msg.subscription_id,
      notice_id: msg.notice.notice_id,
    };
    if (!enabled) {
      console.log("push_off", msg.notice.kind, msg.notice.notice_id);
      await done(obj, null);
      return;
    }
    const vapid = await signer();
    const payload = JSON.stringify(msg.notice);
    let res;
    try {
      res = await fetchImpl(msg.endpoint, {
        method: "POST",
        headers: {
          Authorization: vapid.authorization(msg.endpoint, {
            subject,
            now: now(),
          }),
          TTL: String(TTL_S),
          Urgency: "normal",
          // One per kind: a newer notice of a kind replaces an undelivered
          // older one on the device's push service.
          Topic: msg.notice.kind.replace(/_/g, "-"),
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "aes128gcm",
        },
        body: encryptPayload(payload, msg),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      // Never the endpoint or the error's text: a bounded class only.
      if (receives < PUSH_MAX_RECEIVES) throw err;
      console.error("push_failed", msg.notice.kind, "transport_error");
      await done(obj, { ...base, outcome: "failed" });
      return;
    }
    const status = res.status;
    if (status >= 200 && status < 300) {
      console.log("push_sent", msg.notice.kind, msg.notice.notice_id, status);
      await done(obj, { ...base, outcome: "sent" });
      return;
    }
    if (status === 404 || status === 410) {
      console.log("push_gone", msg.notice.kind, msg.notice.notice_id, status);
      await done(obj, { ...base, outcome: "gone" });
      return;
    }
    if ((status === 429 || status >= 500) && receives < PUSH_MAX_RECEIVES)
      throw new Error(`push_status_${status}`);
    // A refusal (400, 401, 403, 413) will not change on a retry.
    console.error(
      "push_refused",
      msg.notice.kind,
      msg.notice.notice_id,
      status,
    );
    await done(obj, { ...base, outcome: "failed" });
  };
}

/** A receipt's key on the outbox. */
export const pushReceiptKey = () => `push-receipt/${randomUUID()}.json`;
