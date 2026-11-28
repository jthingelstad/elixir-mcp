/**
 * The relay's half of Turnstile (2026-10-14; the doors' half and the
 * modes are in @elixir-mcp/auth/turnstile): before a sign-in mail leaves,
 * ask Cloudflare whether a person asked for it.
 *
 * The doors cannot reach Cloudflare from the NAT-free VPC, so the page's
 * token rides the login message here. Every check logs one
 * `turnstile_checked` line, and that line is the evidence for deciding
 * enforce: a result for each sign-in mail, by door.
 *
 * One token serves one address for five minutes and three sends. A
 * Turnstile token is single-use at Cloudflare, and a person may press
 * "Send another email" with the token the page still holds, so the first
 * verdict is kept (`mail-delivery/turnstile/<sha256 of the token>.json`
 * in the outbox bucket, bound to the address's hash) and a later send
 * reuses it. A token presented for another address fails, and so does a
 * fourth send. A queue retry of the same outbox object is the same send,
 * never a new use.
 */

import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  TURNSTILE_ACTIONS,
  TURNSTILE_HOSTNAME,
  TURNSTILE_ORIGIN,
  turnstileAllows,
  turnstileMode,
} from "@elixir-mcp/auth/turnstile";
import { emailHash } from "@elixir-mcp/auth/crypto";
import { authLog, emailRef } from "@elixir-mcp/auth/audit-log";

export const SITEVERIFY_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;
const TOKEN_VALID_SECONDS = 300;
const MAX_TOKEN_USES = 3;
const VERIFY_TIMEOUT_MS = 4000;
const PREFIX = "mail-delivery/turnstile/";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** A name-based UUID (RFC 9562 version 5, SHA-1) under a namespace of our
 *  own: the same send always asks siteverify with the same key. */
const IDEMPOTENCY_NAMESPACE = "5e1f0c6a-2b7d-4c1e-9a3f-7d2b8c4e6f10";
export function idempotencyKeyFor(use, tokenHash) {
  const bytes = createHash("sha1")
    .update(Buffer.from(IDEMPOTENCY_NAMESPACE.replaceAll("-", ""), "hex"))
    .update(`turnstile:${use}:${tokenHash}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What siteverify said it saw, trimmed for the log line. */
const echoed = (value) =>
  typeof value === "string" ? value.slice(0, 100) : null;

/**
 * The kept verdicts, one object per token. `read` answers
 * `{ record, etag }` or null; `create` and `update` answer false when
 * another send got there first (a conditional write lost).
 */
export function turnstileVerdictStore(bucket, s3) {
  const key = (tokenHash) => `${PREFIX}${tokenHash}.json`;
  const lost = (err) =>
    err?.$metadata?.httpStatusCode === 412 ||
    err?.$metadata?.httpStatusCode === 409;
  const put = async (tokenHash, record, condition) => {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key(tokenHash),
          Body: JSON.stringify(record),
          ContentType: "application/json",
          ServerSideEncryption: "AES256",
          ...condition,
        }),
        { abortSignal: AbortSignal.timeout(3000) },
      );
      return true;
    } catch (err) {
      if (lost(err)) return false;
      throw err;
    }
  };
  return {
    async read(tokenHash) {
      try {
        const out = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key(tokenHash) }),
          { abortSignal: AbortSignal.timeout(3000) },
        );
        return {
          record: JSON.parse(await out.Body.transformToString()),
          etag: out.ETag,
        };
      } catch (err) {
        if (err?.name === "NoSuchKey") return null;
        // A missing key is a 403 without bucket-wide list; an exact-key,
        // one-result list (this prefix only) proves the absence.
        if (err?.$metadata?.httpStatusCode === 403) {
          const listed = await s3.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: key(tokenHash),
              MaxKeys: 1,
            }),
            { abortSignal: AbortSignal.timeout(3000) },
          );
          if (listed.KeyCount === 0 && listed.IsTruncated === false)
            return null;
        }
        throw err;
      }
    },
    create: (tokenHash, record) => put(tokenHash, record, { IfNoneMatch: "*" }),
    update: (tokenHash, record, etag) =>
      put(tokenHash, record, { IfMatch: etag }),
  };
}

/**
 * One siteverify call. `idempotencyKey` (a UUID, Cloudflare's
 * `idempotency_key`) is the send's own, so the queue retrying a send whose
 * verdict could not be kept asks again as the same request and is not
 * told `timeout-or-duplicate` for a person's real token.
 *
 * A success is a pass only when Cloudflare saw the token drawn on our
 * hostname by the door's own action (Cloudflare's docs say to check
 * both): otherwise it is a fail, `hostname-mismatch` or
 * `action-mismatch`. A failure of Cloudflare's or ours (HTTP, timeout,
 * `internal-error`, a rejected secret) stays an error, which every mode
 * sends.
 */
async function siteverify(
  fetchImpl,
  secret,
  token,
  { surface, idempotencyKey },
) {
  try {
    const form = { secret, response: token };
    if (idempotencyKey) form.idempotency_key = idempotencyKey;
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { result: "error", codes: [`http_${res.status}`] };
    const data = await res.json();
    const codes = Array.isArray(data?.["error-codes"])
      ? data["error-codes"].map(String).slice(0, 5)
      : [];
    // A rejected secret or a malformed request is ours to fix, and
    // Cloudflare's own internal error is retryable: none is the
    // visitor's failure, so none refuses mail or is kept.
    if (
      !data?.success &&
      codes.some(
        (c) =>
          c.includes("secret") || c === "bad-request" || c === "internal-error",
      )
    )
      return { result: "error", codes };
    const hostname = echoed(data?.hostname);
    const action = echoed(data?.action);
    if (data?.success === true) {
      const mismatch = [];
      if (hostname !== TURNSTILE_HOSTNAME) mismatch.push("hostname-mismatch");
      if (action !== TURNSTILE_ACTIONS[surface])
        mismatch.push("action-mismatch");
      if (mismatch.length)
        return { result: "fail", codes: mismatch, hostname, action };
    }
    return {
      result: data?.success === true ? "pass" : "fail",
      codes,
      hostname,
      action,
    };
  } catch (err) {
    return { result: "error", codes: [String(err?.name ?? "Error")] };
  }
}

/**
 * `check({ surface, token, to, use })` for one login message: `use` names
 * the send (its outbox key), so a retry is not a second use. Never
 * throws: the verdict says whether to send (`allowed`) and was logged.
 *
 * Results: pass / fail (Cloudflare's answer, or a token kept for another
 * address or used up), missing (the page sent none), error (Cloudflare
 * could not be asked), unconfigured (no secret yet), off.
 */
export function makeTurnstileCheck({
  secret,
  store = null,
  fetchImpl = fetch,
  now = Date.now,
  env = process.env,
}) {
  return async function check({ surface, token, to, use }) {
    const mode = turnstileMode(env);
    if (mode === "off")
      return { result: "off", mode, allowed: true, codes: [], reused: false };
    const hash = emailHash(to);
    const done = (result, codes = [], reused = false, extra = {}) => {
      const verdict = {
        result,
        mode,
        allowed: turnstileAllows(mode, result),
        codes,
        reused,
      };
      authLog("turnstile_checked", {
        surface,
        result,
        mode,
        allowed: verdict.allowed,
        reused,
        codes: codes.length ? codes : null,
        email: emailRef(hash),
        ...extra,
      });
      return verdict;
    };

    if (!token) return done("missing");
    if (!secret) return done("unconfigured");

    const tokenHash = sha256(token);
    const nowMs = now();
    const fresh = (record) =>
      nowMs / 1000 - Number(record?.verified_at ?? 0) <= TOKEN_VALID_SECONDS;
    const fromKept = async (kept) => {
      const { record, etag } = kept;
      if (record.email_hash !== hash)
        return done("fail", ["token-other-address"], true);
      // Kept from the other door's page: what siteverify would have
      // called an action mismatch. A record from before the action was
      // kept carries none and is taken as it stands.
      if (
        typeof record.action === "string" &&
        record.action !== TURNSTILE_ACTIONS[surface]
      )
        return done("fail", ["action-mismatch"], true);
      const uses = Array.isArray(record.uses) ? record.uses : [];
      if (use && uses.includes(use))
        return done(record.result, record.codes ?? [], true);
      if (uses.length >= MAX_TOKEN_USES)
        return done("fail", ["token-used-up"], true);
      try {
        await store.update(
          tokenHash,
          { ...record, uses: [...uses, use ?? `send-${nowMs}`] },
          etag,
        );
      } catch {
        // The verdict stands; the count is a ceiling, not the check.
        authLog("turnstile_store_failed", { op: "update" });
      }
      return done(record.result, record.codes ?? [], true);
    };

    let kept = null;
    if (store) {
      try {
        kept = await store.read(tokenHash);
      } catch {
        authLog("turnstile_store_failed", { op: "read" });
      }
    }
    if (kept && fresh(kept.record)) return fromKept(kept);

    const answer = await siteverify(fetchImpl, secret, token, {
      surface,
      idempotencyKey: use ? idempotencyKeyFor(use, tokenHash) : null,
    });
    const extra = { hostname: answer.hostname, action: answer.action };
    if (answer.result === "error") return done("error", answer.codes);
    if (store) {
      // The verdict after the hostname and action checks, so a resend
      // reusing it is judged as the first send was.
      const record = {
        result: answer.result,
        codes: answer.codes,
        action: answer.action,
        email_hash: hash,
        uses: [use ?? `send-${nowMs}`],
        verified_at: Math.floor(nowMs / 1000),
      };
      try {
        // Lost to another send of the same token: its verdict is the one
        // Cloudflare gave first (ours is then a duplicate), so use it.
        if (!(await store.create(tokenHash, record))) {
          const first = await store.read(tokenHash);
          if (first && fresh(first.record)) return fromKept(first);
        }
      } catch {
        authLog("turnstile_store_failed", { op: "create" });
      }
    }
    return done(answer.result, answer.codes, false, extra);
  };
}
