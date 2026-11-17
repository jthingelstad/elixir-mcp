/**
 * Web push in the relay (2026-11-16): the payload encryption against RFC
 * 8291's own test vector, a round trip a device would decrypt, the VAPID
 * header a push service verifies, and the worker's outcomes (sent, gone,
 * retry, refused, off). Keys here are made per run or are the RFC's;
 * Elixir's own pair is never read by a test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  verify,
} from "node:crypto";
import {
  checkPushMessage,
  createWebPushWorker,
  encryptPayload,
  vapidFromSecret,
  vapidSigner,
} from "../src/web-push.mjs";

const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** What a device does with a push: RFC 8291 from the receiving end. */
function decrypt(body, uaPrivate, auth) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const sealed = body.subarray(21 + idlen);
  const ua = createECDH("prime256v1");
  ua.setPrivateKey(Buffer.from(uaPrivate, "base64url"));
  const shared = ua.computeSecret(asPublic);
  const info = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    ua.getPublicKey(),
    asPublic,
  ]);
  const ikm = Buffer.from(
    hkdfSync("sha256", shared, Buffer.from(auth, "base64url"), info, 32),
  );
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
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  const out = Buffer.concat([
    d.update(sealed.subarray(0, sealed.length - 16)),
    d.final(),
  ]);
  assert.equal(out[out.length - 1], 2, "the last record's delimiter");
  return out.subarray(0, out.length - 1).toString();
}

function device() {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  return {
    uaPrivate: ua.getPrivateKey().toString("base64url"),
    p256dh: ua.getPublicKey().toString("base64url"),
    auth: Buffer.alloc(16, 7).toString("base64url"),
  };
}

function vapidPair() {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return {
    vapid_public_key: e.getPublicKey().toString("base64url"),
    vapid_private_key: e.getPrivateKey().toString("base64url"),
  };
}

test("encryption: RFC 8291's test vector, byte for byte", () => {
  const out = encryptPayload(
    RFC.plaintext,
    { p256dh: RFC.uaPublic, auth: RFC.auth },
    {
      asKeys: { private: RFC.asPrivate },
      salt: Buffer.from(RFC.salt, "base64url"),
    },
  );
  assert.equal(out.toString("base64url"), RFC.body);
  assert.equal(decrypt(out, RFC.uaPrivate, RFC.auth), RFC.plaintext);
});

test("encryption: a fresh key and salt each time, and a device reads it", () => {
  const d = device();
  const a = encryptPayload('{"title":"3 cheers"}', d);
  const b = encryptPayload('{"title":"3 cheers"}', d);
  assert.notDeepEqual(a, b);
  assert.equal(decrypt(a, d.uaPrivate, d.auth), '{"title":"3 cheers"}');
  assert.throws(() => encryptPayload("x", { ...d, auth: "short" }), /bad_auth/);
});

test("VAPID: an ES256 token for the endpoint's origin, signed by the pair", () => {
  const pair = vapidPair();
  const signer = vapidSigner(pair);
  const header = signer.authorization(
    "https://fcm.googleapis.com/fcm/send/abc",
    { subject: "https://elixir.poapkings.com", now: 1_700_000_000_000 },
  );
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[2], pair.vapid_public_key);
  const [h, c, s] = m[1].split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), {
    typ: "JWT",
    alg: "ES256",
  });
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "https://elixir.poapkings.com");
  assert.equal(claims.exp, 1_700_000_000 + 12 * 3600);
  const pub = Buffer.from(pair.vapid_public_key, "base64url");
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
  assert.ok(
    verify(
      "sha256",
      Buffer.from(`${h}.${c}`),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(s, "base64url"),
    ),
  );
  // A public key that is not the private key's: nothing is signed.
  assert.throws(
    () =>
      vapidSigner({ ...pair, vapid_public_key: vapidPair().vapid_public_key }),
    /vapid_keys_mismatch/,
  );
});

test("VAPID from the secret: read once, kept in memory", async () => {
  const pair = vapidPair();
  let reads = 0;
  const get = vapidFromSecret(async () => {
    reads++;
    return JSON.stringify(pair);
  });
  const a = await get();
  const b = await get();
  assert.equal(a, b);
  assert.equal(reads, 1);
  await assert.rejects(
    vapidFromSecret(async () => "not json")(),
    /vapid_secret_shape/,
  );
});

const NOTICE = {
  notice_id: "00000000-0000-4000-8000-000000000001",
  kind: "cheers",
  title: "3 cheers on your play",
  body: "Invented Owner played 12 battles",
  url: "/home/player/%230QQG0JVQQ",
};

function message(d, over = {}) {
  return {
    v: 1,
    subscription_id: "7",
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    p256dh: d.p256dh,
    auth: d.auth,
    notice: NOTICE,
    ...over,
  };
}

test("a message names a push service and a path on Elixir, or it is refused", () => {
  const d = device();
  assert.ok(checkPushMessage(message(d)));
  assert.equal(
    checkPushMessage(message(d, { endpoint: "https://evil.example/push" })),
    null,
  );
  assert.equal(
    checkPushMessage(message(d, { endpoint: "http://fcm.googleapis.com/x" })),
    null,
  );
  assert.equal(
    checkPushMessage(
      message(d, { notice: { ...NOTICE, url: "https://evil.example/" } }),
    ),
    null,
  );
  assert.equal(
    checkPushMessage(
      message(d, { notice: { ...NOTICE, url: "//evil.example" } }),
    ),
    null,
  );
  assert.equal(
    checkPushMessage(message(d, { notice: { ...NOTICE, kind: "who" } })),
    null,
  );
});

function harness(d, { status = 201, enabled = true, throws = null } = {}) {
  const pair = vapidPair();
  const sent = [];
  const receipts = [];
  const deleted = [];
  const worker = createWebPushWorker({
    enabled,
    signer: vapidFromSecret(async () => JSON.stringify(pair)),
    subject: "https://elixir.poapkings.com",
    readObject: async () => JSON.stringify(message(d)),
    deleteObject: async (obj) => deleted.push(obj.key),
    receipt: async (r) => receipts.push(r),
    fetchImpl: async (url, init) => {
      if (throws) throw throws;
      sent.push({ url, init });
      return { status };
    },
  });
  return { worker, sent, receipts, deleted };
}

const OBJ = { bucket: "b", key: "web-push/x.json" };

test("worker: sends the encrypted notice, receipts it, deletes the object", async () => {
  const d = device();
  const h = harness(d);
  await h.worker(OBJ);
  assert.equal(h.sent.length, 1);
  const { url, init } = h.sent[0];
  assert.equal(url, "https://fcm.googleapis.com/fcm/send/abc");
  assert.equal(init.headers["Content-Encoding"], "aes128gcm");
  assert.equal(init.headers.Topic, "cheers");
  assert.match(init.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decrypt(init.body, d.uaPrivate, d.auth)), NOTICE);
  assert.deepEqual(h.receipts, [
    {
      v: 1,
      subscription_id: "7",
      notice_id: NOTICE.notice_id,
      outcome: "sent",
    },
  ]);
  assert.deepEqual(h.deleted, [OBJ.key]);
  // The receipt never carries the endpoint.
  assert.doesNotMatch(JSON.stringify(h.receipts), /googleapis/);
});

test("worker: 410 is gone, 429 retries then gives up, 400 is refused, off sends nothing", async () => {
  const d = device();
  const gone = harness(d, { status: 410 });
  await gone.worker(OBJ);
  assert.equal(gone.receipts[0].outcome, "gone");

  const busy = harness(d, { status: 429 });
  await assert.rejects(busy.worker(OBJ, { receives: 1 }), /push_status_429/);
  assert.deepEqual(busy.deleted, []);
  await busy.worker(OBJ, { receives: 3 });
  assert.equal(busy.receipts[0].outcome, "failed");
  assert.deepEqual(busy.deleted, [OBJ.key]);

  const down = harness(d, { throws: new Error("socket hang up") });
  await assert.rejects(down.worker(OBJ, { receives: 2 }));
  await down.worker(OBJ, { receives: 3 });
  assert.equal(down.receipts[0].outcome, "failed");

  const refused = harness(d, { status: 400 });
  await refused.worker(OBJ);
  assert.equal(refused.receipts[0].outcome, "failed");

  const off = harness(d, { enabled: false });
  await off.worker(OBJ);
  assert.equal(off.sent.length, 0);
  assert.deepEqual(off.receipts, []);
  assert.deepEqual(off.deleted, [OBJ.key]);
});
