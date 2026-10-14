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

async function siteverify(fetchImpl, secret, token) {
  try {
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
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
    return {
      result: data?.success ? "pass" : "fail",
      codes,
      hostname: typeof data?.hostname === "string" ? data.hostname : null,
      action: typeof data?.action === "string" ? data.action : null,
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

    const answer = await siteverify(fetchImpl, secret, token);
    const extra = { hostname: answer.hostname, action: answer.action };
    if (answer.result === "error") return done("error", answer.codes);
    if (store) {
      const record = {
        result: answer.result,
        codes: answer.codes,
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
